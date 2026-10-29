#!/bin/sh
# Install a user-level launcher in ~/.local/bin (no sudo, no network).
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
BIN_DIR="${HOME}/.local/bin"
TARGET="${BIN_DIR}/sg-local"

chmod +x "${SCRIPT_DIR}/sg-local"

"${SCRIPT_DIR}/sg-local" --version >/dev/null

mkdir -p "${BIN_DIR}"
if [ -e "${TARGET}" ] && [ ! -L "${TARGET}" ]; then
    echo "Refusing to overwrite ${TARGET}; move it aside and run this again." >&2
    exit 1
fi
ln -sfn "${SCRIPT_DIR}/sg-local" "${TARGET}"

echo "Installed: ${TARGET}"
case ":${PATH}:" in
    *":${BIN_DIR}:"*) ;;
    *) echo "Add ${BIN_DIR} to PATH, for example:"
       echo "  echo 'export PATH=\"\$HOME/.local/bin:\$PATH\"' >> ~/.zshrc" ;;
esac

echo
echo "Next:"
echo "  sg-local add"
echo "  sg-local start"
echo "  sg-local status"
