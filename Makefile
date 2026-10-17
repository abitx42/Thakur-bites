.PHONY: setup build build-web run test test-all test-rules test-flutter audit

export PUB_CACHE := $(CURDIR)/.cache/pub
export FIREBASE_EMULATORS_PATH := $(CURDIR)/.cache/firebase/emulators
export npm_config_cache := $(CURDIR)/.cache/npm

setup:
	node -e "if(process.versions.node !== require('fs').readFileSync('.nvmrc','utf8').trim()) process.exit(1)"
	test "$$(npm --version)" = "10.9.9"
	npm ci
	npm --prefix functions ci
	node scripts/setup_flutter.js
	npm run setup:emulators

build:
	npm run build

build-web:
	npm run build:web

run:
	npm start

# Deterministic offline regression suite after setup. No cloud credentials or network required.
test:
	npm test

test-rules:
	npm run test:rules

test-flutter:
	npm run test:flutter

test-all: test test-flutter test-rules

audit:
	npm audit --audit-level=low
	npm --prefix functions audit --audit-level=low
	npm run security-check
