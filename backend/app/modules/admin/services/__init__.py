"""Admin services sub-package.

Holds the three service modules that back the admin router:

- ``roles_service`` (task-04)
- ``organizations_service`` (task-05)
- ``users_service`` (task-06)

Each module is imported lazily from the corresponding router so a
fault in one service never blocks import of the others.
"""

from __future__ import annotations
