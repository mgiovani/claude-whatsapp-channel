.PHONY: dev install clean test

# Start Claude Code with the WhatsApp channel loaded for development
dev:
	npm install --silent && claude --dangerously-load-development-channels server:whatsapp

# Install dependencies
install:
	bun install

# Run unit tests
test:
	bun test

# Clear the plugin cache (forces re-cache from source on next start)
clean:
	rm -rf ~/.claude/plugins/cache/whatsapp-local/
