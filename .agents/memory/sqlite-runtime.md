---
name: SQLite runtime choice
description: Why this project uses the Node runtime SQLite implementation instead of a native npm driver.
---

This project uses Node 24's built-in `node:sqlite` implementation for the demo game store rather than a native SQLite npm dependency.

**Why:** The requested product is explicitly SQLite-backed and the workspace runtime already provides SQLite, so this avoids native package installation and keeps the demo portable.

**How to apply:** Keep persistence changes inside the game store module and preserve the file-backed database behavior unless the product requirements change.