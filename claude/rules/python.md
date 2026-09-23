# Python

Existing repo → its tooling and conventions win (requirements.txt, unittest, no type hints). Rules below = new projects/code. Never migrate unasked.

## Tooling

- `uv` for everything: `uv add`, `uv run`, `uv sync`. No `pip install`, no manual `venv`, no `requirements.txt`, no `setup.py`.
- `pyproject.toml` only. Deps go in it, not a side file.
- `ruff check --fix` + `ruff format`. No black, no isort, no flake8.
- `ty` or `mypy --strict` only if repo already has it. Don't add.

## Code

- `pathlib.Path`, never `os.path` string joins.
- Type hints on public functions. Skip on locals and obvious returns.
- `dataclass` (or `NamedTuple`) over dict-as-record. No class for stateless helpers — module function.
- f-strings. No `%` or `.format()` — except logging args (`log.info("%s", v)`).
- Stdlib first: `itertools`, `collections`, `functools.lru_cache`, `json`, `sqlite3`, `subprocess.run`. Check before adding dep.
- Network / subprocess call → explicit `timeout=`.
- `async def` only when it awaits. Blocking I/O inside async → `run_in_threadpool` / `asyncio.to_thread`.
- Context manager for anything opened. `with`, always.
- Catch narrow (`except KeyError`), never bare `except:`.

## Tests

- `pytest`, plain `assert`. No `unittest`, no fixtures until a fixture is reused 3x.
- Tests for a module live in `tests/test_<mod>.py`.
- Test behaviour at the boundary, not private helpers.
