#!/usr/bin/env python3
"""Clear or display buffered fcktaps warnings."""

import sys
from pathlib import Path


def clear(path: Path) -> None:
    path.unlink(missing_ok=True)


def read_messages(path: Path) -> list[str]:
    if not path.is_file():
        return []
    messages = []
    seen = set()
    for line in path.read_text(encoding="utf8").splitlines():
        message = line.strip()
        if message and message not in seen:
            seen.add(message)
            messages.append(message)
    return messages


def print_messages(messages: list[str]) -> None:
    # ANSI bright colors use the terminal's own palette/theme. The explicit
    # user-facing message styles take precedence over an inherited NO_COLOR;
    # redirected logs remain escape-free because stderr is then not a TTY.
    use_color = sys.stderr.isatty()
    yellow = "\033[1;93m" if use_color else ""
    cyan = "\033[1;96m" if use_color else ""
    reset = "\033[0m" if use_color else ""
    for message in messages:
        if message.startswith("DEBUG -- "):
            print(f"{cyan}DEBUG{reset}{message.removeprefix('DEBUG')}\n", file=sys.stderr)
        else:
            print(f"{yellow}WARNING{reset} -- {message}\n", file=sys.stderr)


def show(path: Path) -> None:
    print_messages(read_messages(path))


def main() -> None:
    if len(sys.argv) != 3 or sys.argv[1] not in {"clear", "show"}:
        print("Usage: report_warnings.py <clear|show> <warnings-file>", file=sys.stderr)
        sys.exit(2)

    path = Path(sys.argv[2])
    clear(path) if sys.argv[1] == "clear" else show(path)


if __name__ == "__main__":
    main()
