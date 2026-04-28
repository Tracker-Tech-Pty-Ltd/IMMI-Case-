# frontend/Makefile — delegate to repo-root Makefile so commands like
# `make build`, `make test-fe`, `make typecheck` work from inside frontend/.
#
# Without this delegate, running `make <target>` from frontend/ would fail
# with "No targets specified and no makefile found" because GNU make does
# not auto-traverse to a parent directory.
#
# Implementation note: the catch-all `%:` rule forwards every unknown
# target to the parent Makefile via `$(MAKE) -C ../`. The repo-root
# Makefile resolves REPO_ROOT from its own MAKEFILE_LIST so its `cd`
# targets still land in the correct frontend/ regardless of invocation cwd.

.DEFAULT_GOAL := help

%:
	@$(MAKE) -C $(dir $(abspath $(lastword $(MAKEFILE_LIST))))/.. $@
