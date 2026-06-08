# frontend/Makefile — delegate to repo-root Makefile so commands like
# `make build`, `make test-fe`, `make typecheck` work from inside frontend/.
#
# Without this delegate, running `make <target>` from frontend/ would fail
# with "No targets specified and no makefile found" because GNU make does
# not auto-traverse to a parent directory.
#
# Implementation note: the catch-all `%:` rule forwards every unknown
# target to the parent Makefile via `$(MAKE) -C ..`.

.DEFAULT_GOAL := help

%:
	@$(MAKE) -C .. $@
