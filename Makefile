.PHONY: dev install clean test logout

# Start Claude Code with the WhatsApp channel loaded for development
dev:
	npm install --silent && claude --plugin-dir . --dangerously-load-development-channels server:whatsapp

# Install dependencies (Node.js runtime; bun is used for testing only)
install:
	npm install

# Run unit tests
test:
	bun test

# Unlink the WhatsApp session and clear auth state
logout:
	node --experimental-strip-types scripts/configure.ts logout

# Clear the plugin cache (forces re-cache from source on next start)
clean:
	rm -rf ~/.claude/plugins/cache/whatsapp-channel/
