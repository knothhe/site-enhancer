.DEFAULT_GOAL := help

RELEASE_COMMAND ?= node scripts/release.mjs
VERSION_BUMP ?= patch
RELEASE_FLAGS ?=
INSTALL_COMMAND ?= pnpm install:local
INSTALL_FLAGS ?=

.PHONY: help version release release-initial install

help:
	@printf '%s\n' \
	  'make version                         Show the current version' \
	  'make release                         Preview a patch release' \
	  'make release VERSION_BUMP=minor       Preview a minor release (also major or an exact version)' \
	  'make release RELEASE_FLAGS=--apply    Check, bump, commit, tag, push and create GitHub Release' \
	  'make release-initial                 Preview publishing the current, unpublished version' \
	  'make install                         Build and sync Chrome using .install-local.json' \
	  'make install INSTALL_FLAGS=--help     Show local installer options'

version:
	@node -p 'JSON.parse(require("node:fs").readFileSync("package.json", "utf8")).version'

release:
	$(RELEASE_COMMAND) $(VERSION_BUMP) $(RELEASE_FLAGS)

release-initial:
	$(RELEASE_COMMAND) initial $(RELEASE_FLAGS)

install:
	$(INSTALL_COMMAND) $(INSTALL_FLAGS)
