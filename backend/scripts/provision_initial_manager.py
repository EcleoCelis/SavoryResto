"""Convenience wrapper for initial manager provisioning.

Delegates directly to app.cli.cmd_create_initial_manager to ensure a single,
canonical implementation.
"""

from pathlib import Path
import sys

# Ensure backend root is on sys.path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.cli import main

if __name__ == "__main__":
    sys.exit(main(["create-initial-manager"] + sys.argv[1:]))
