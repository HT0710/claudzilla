# Python

## Tooling

- `uv` for everything: `uv add`, `uv run`, `uv sync`. No `pip install`, no manual `venv`, no `requirements.txt`, no `setup.py`.
- `pyproject.toml` only. Deps go in it, not a side file.
- `ruff check --fix` + `ruff format`. No black, no isort, no flake8.
- `ty` or `mypy --strict` only if repo already has it. Don't add.

## Code

- `pathlib.Path`, never `os.path` string joins.
- Type hints on public functions. Skip on locals and obvious returns.
- `dataclass` (or `NamedTuple`) over dict-as-record. No class for stateless helpers — module function.
- f-strings. No `%` or `.format()`.
- Stdlib first: `itertools`, `collections`, `functools.lru_cache`, `json`, `sqlite3`, `subprocess.run`. Check before adding dep.
- Context manager for anything opened. `with`, always.
- Catch narrow (`except KeyError`), never bare `except:`.

## Tests

- `pytest`, plain `assert`. No `unittest`, no fixtures until a fixture is reused 3x.
- One test file mirrors one module: `src/foo.py` → `tests/test_foo.py`.
- Test behaviour at the boundary, not private helpers.
