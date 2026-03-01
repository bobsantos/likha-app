.PHONY: setup

setup:
	git config core.hooksPath scripts/hooks
	@echo "✅ Git hooks configured (scripts/hooks/)"
