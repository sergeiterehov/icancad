/**
 * The Python side of the engine. It receives one JSON batch and returns one
 * JSON batch; the AST allowlist is the security boundary of the sandbox.
 */
export const PYTHON_SOURCE = String.raw`
import ast
import io
import json
import math
import sys
import tokenize


class FormulaError(Exception):
    def __init__(self, code, message, args=None, line=None, column=None):
        super().__init__(message)
        self.diag = {
            'code': code,
            'message': message,
            'args': args or {},
        }
        if line is not None:
            self.diag['line'] = line
        if column is not None:
            self.diag['column'] = column


class CycleError(Exception):
    def __init__(self, cycle):
        super().__init__(' -> '.join(cycle))
        self.cycle = cycle


_CALLS = {'abs', 'all', 'any', 'float', 'int', 'len', 'max', 'min', 'round', 'str', 'sum'}

_ENV = {
    'abs': abs,
    'all': all,
    'any': any,
    'float': float,
    'int': int,
    'len': len,
    'max': max,
    'min': min,
    'round': round,
    'str': str,
    'sum': sum,
    'math': math,
}

_ALLOWED = (
    ast.Expression,
    ast.Constant,
    ast.Name,
    ast.Load,
    ast.BinOp,
    ast.Add,
    ast.Sub,
    ast.Mult,
    ast.Div,
    ast.FloorDiv,
    ast.Mod,
    ast.Pow,
    ast.UnaryOp,
    ast.UAdd,
    ast.USub,
    ast.Not,
    ast.BoolOp,
    ast.And,
    ast.Or,
    ast.Compare,
    ast.Eq,
    ast.NotEq,
    ast.Lt,
    ast.LtE,
    ast.Gt,
    ast.GtE,
    ast.In,
    ast.NotIn,
    ast.Is,
    ast.IsNot,
    ast.IfExp,
    ast.Call,
    ast.keyword,
    ast.Attribute,
    ast.Subscript,
    ast.Slice,
    ast.List,
    ast.Tuple,
    ast.Dict,
    ast.Set,
)


def _parse(source):
    try:
        tree = ast.parse(source, mode='eval')
    except SyntaxError as error:
        raise FormulaError(
            'SYNTAX', error.msg, {'detail': error.msg}, error.lineno, error.offset
        )
    for node in ast.walk(tree):
        if not isinstance(node, _ALLOWED):
            raise FormulaError(
                'SYNTAX',
                'Unsupported syntax: ' + type(node).__name__,
                {'detail': type(node).__name__},
            )
        if isinstance(node, ast.Attribute):
            if node.attr.startswith('_') or node.attr == '':
                raise FormulaError('SYNTAX', 'Private attributes are not allowed')
        if isinstance(node, ast.Name) and node.id.startswith('__'):
            raise FormulaError('SYNTAX', 'Private names are not allowed')
        if isinstance(node, ast.Call):
            func = node.func
            if isinstance(func, ast.Name):
                if func.id not in _CALLS:
                    raise FormulaError(
                        'SYNTAX',
                        'Unsupported function: ' + func.id,
                        {'name': func.id},
                    )
            elif isinstance(func, ast.Attribute):
                if not (isinstance(func.value, ast.Name) and func.value.id == 'math'):
                    raise FormulaError('SYNTAX', 'Only math functions can be called')
            else:
                raise FormulaError('SYNTAX', 'Unsupported call')
    return tree


def _deps(tree):
    names = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Name) and isinstance(node.ctx, ast.Load):
            names.add(node.id)
    return sorted(names)


def _number(value, expected='number'):
    if isinstance(value, bool):
        raise FormulaError(
            'TYPE',
            'Expected a number, got a boolean',
            {'expected': expected, 'actual': 'boolean'},
        )
    if isinstance(value, (int, float)):
        number = float(value)
        if not math.isfinite(number):
            raise FormulaError(
                'VALUE',
                'The result is not a finite number',
                {'detail': 'not finite'},
            )
        return number
    raise FormulaError(
        'TYPE',
        'Expected a number, got ' + type(value).__name__,
        {'expected': expected, 'actual': type(value).__name__},
    )


def _evaluate(tree, scope, failed=()):
    try:
        return eval(compile(tree, '<formula>', 'eval'), {'__builtins__': {}}, scope)
    except NameError as error:
        name = getattr(error, 'name', None)
        if name and name in failed:
            raise FormulaError(
                'DEPENDENCY_ERROR',
                "Depends on a failed variable '" + name + "'",
                {'name': name},
            )
        if name:
            raise FormulaError(
                'UNKNOWN_NAME', "name '" + name + "' is not defined", {'name': name}
            )
        raise FormulaError('VALUE', str(error), {'detail': str(error)})
    except ZeroDivisionError:
        raise FormulaError('VALUE', 'Division by zero', {'detail': 'division by zero'})
    except TypeError as error:
        raise FormulaError('TYPE', str(error), {'detail': str(error)})
    except FormulaError:
        raise
    except Exception as error:
        raise FormulaError('VALUE', str(error), {'detail': type(error).__name__})


def _scope_with(values):
    scope = dict(_ENV)
    scope.update(values)
    return scope


def _resolve(name, by_name, stack, values):
    record = by_name.get(name)
    if record is None:
        raise FormulaError(
            'UNKNOWN_NAME', "name '" + name + "' is not defined", {'name': name}
        )
    if record['type'] == 'string':
        record['value'] = record['source']
        return record['value']
    state = record.get('state', 'new')
    if state == 'done':
        if record.get('error'):
            raise FormulaError(
                'DEPENDENCY_ERROR',
                "Depends on a failed variable '" + name + "'",
                {'name': name},
            )
        return record.get('value')
    if state == 'busy':
        start = stack.index(name) if name in stack else 0
        raise CycleError(stack[start:] + [name])
    record['state'] = 'busy'
    stack.append(name)
    value = None
    failure = None
    try:
        for dep in record['deps']:
            if dep not in by_name:
                continue
            # Project variables are visible to the whole project; a model
            # variable is only visible after its own model variables are in
            # scope, so a project expression must not read one.
            if record['scope'] == 'project' and by_name[dep].get('scope') == 'model':
                continue
            try:
                _resolve(dep, by_name, stack, values)
            except CycleError:
                raise
            except FormulaError:
                failure = FormulaError(
                    'DEPENDENCY_ERROR',
                    "Depends on a failed variable '" + dep + "'",
                    {'name': dep},
                )
                break
        if failure is not None:
            raise failure
        visible = values
        if record['scope'] == 'project':
            visible = {
                key: value
                for key, value in values.items()
                if by_name.get(key, {}).get('scope') != 'model'
            }
        value = _evaluate(record['tree'], _scope_with(visible), ())
        value = _number(value)
        values[name] = value
    except FormulaError as error:
        record['state'] = 'done'
        record['error'] = error.diag
        if error.diag['code'] == 'DEPENDENCY_ERROR':
            record['error'] = error.diag
        raise
    finally:
        if name in stack:
            stack.remove(name)
    record['state'] = 'done'
    record['value'] = value
    return value


def _evaluate_variables(variable_sources):
    by_name = {}
    values = {}
    for source in variable_sources:
        record = {
            'id': source.get('id', ''),
            'name': source['name'],
            'type': source.get('type', 'number'),
            'source': source.get('source', ''),
            'scope': source.get('scope', 'project'),
            'state': 'new',
        }
        if record['type'] == 'number':
            try:
                record['tree'] = _parse(record['source'])
                record['deps'] = _deps(record['tree'])
            except FormulaError as error:
                record['state'] = 'done'
                record['error'] = error.diag
        else:
            record['deps'] = []
            values[record['name']] = record['source']
        by_name[record['name']] = record
    failed = set()
    for name in list(by_name.keys()):
        record = by_name[name]
        if record.get('state') == 'done':
            if record.get('error'):
                failed.add(name)
            elif record['type'] == 'number' and record.get('value') is not None:
                values[name] = record['value']
            continue
        try:
            _resolve(name, by_name, [], values)
        except CycleError as error:
            names = error.cycle[:-1]
            text = ' -> '.join(error.cycle)
            for cycle_name in names:
                cycle_record = by_name[cycle_name]
                cycle_record['state'] = 'done'
                cycle_record['error'] = {
                    'code': 'CYCLE',
                    'message': 'Circular reference: ' + text,
                    'args': {'cycle': text},
                }
                failed.add(cycle_name)
        except FormulaError:
            pass
        if record.get('error'):
            failed.add(name)
        elif record['type'] == 'number' and record.get('value') is not None:
            values[name] = record['value']
    results = []
    for name in by_name:
        record = by_name[name]
        result = {'id': record['id'], 'name': name}
        if record.get('error'):
            result['error'] = record['error']
        elif record['type'] == 'string':
            result['value'] = record['source']
        else:
            result['value'] = record.get('value')
        results.append(result)
    return values, failed, results


def _rename_source(source, old, new):
    try:
        tokens = list(tokenize.generate_tokens(io.StringIO(source).readline))
    except (tokenize.TokenError, IndentationError, SyntaxError):
        return source
    lines = source.splitlines(keepends=True)
    spans = {}
    for token in tokens:
        if token.type == tokenize.NAME and token.string == old:
            spans.setdefault(token.start[0], []).append((token.start[1], token.end[1]))
    if not spans:
        return source
    for row, positions in spans.items():
        line = lines[row - 1]
        for start, end in sorted(positions, reverse=True):
            line = line[:start] + new + line[end:]
        lines[row - 1] = line
    return ''.join(lines)


def rename(raw):
    request = json.loads(raw)
    old = request.get('oldName', '')
    new = request.get('newName', '')

    def rewrite(items):
        result = []
        for item in items:
            copy = dict(item)
            copy['source'] = _rename_source(item.get('source', ''), old, new)
            result.append(copy)
        return result

    return json.dumps({
        'variables': rewrite(request.get('variables', [])),
        'expressions': rewrite(request.get('expressions', [])),
    })


def evaluate(raw):
    request = json.loads(raw)
    values, failed, variables = _evaluate_variables(request.get('variables', []))
    results = []
    for source in request.get('expressions', []):
        result = {'targetId': source.get('targetId', ''), 'path': source.get('path', '')}
        try:
            tree = _parse(source.get('source', ''))
            result['dependencies'] = _deps(tree)
            value = _evaluate(tree, _scope_with(values), failed)
            result['value'] = _number(value)
        except FormulaError as error:
            if 'dependencies' not in result:
                try:
                    result['dependencies'] = _deps(_parse(source.get('source', '')))
                except FormulaError:
                    result['dependencies'] = []
            result['error'] = error.diag
        except Exception as error:
            result['error'] = {
                'code': 'VALUE',
                'message': str(error),
                'args': {'detail': type(error).__name__},
            }
        results.append(result)
    return json.dumps({
        'variables': variables,
        'results': results,
        'engine': {'python': sys.version.split()[0], 'pyodide': ''},
    })
`;
