.PHONY: dev install clean test

# Start Claude Code with the WhatsApp channel loaded for development
dev:
	npm install --silent && claude --plugin-dir . --dangerously-load-development-channels server:whatsapp

# Install dependencies (Node.js runtime; bun is used for testing only)
install:
	npm install

# Run unit tests
test:
	bun test

# Clear the plugin cache (forces re-cache from source on next start)
clean:
	rm -rf ~/.claude/plugins/cache/whatsapp-channel/
