#!/bin/bash

# SYNOPSIS
#     Automates the release process for ClawExpress.
#
# DESCRIPTION
#     This script automates the version release process by:
#     1. Auto-incrementing version from latest git tag (when using 'next')
#     2. Updating the version in app/package.json and app/electron-builder.yml
#     3. Committing the changes to the private repo
#     4. Pushing the commit
#     5. Creating and pushing a git tag -> triggers GitHub Actions CI
#     6. CI builds Win/Mac/Linux and publishes to ClawKits/ClawExpress (public)
#
#     MODES:
#     - next [comment]: Auto-increment patch version, create production release
#     - preview [comment]: Auto-increment and create preview release
#     - test: Push code to main to trigger CI build check (no release)
#     - <version> [comment]: Specify exact version to publish
#     - -d <version>: Delete a tag/release locally and remotely

set -e

# -- Colors --
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
CYAN='\033[0;36m'
MAGENTA='\033[0;35m'
BLUE='\033[0;34m'
WHITE='\033[1;37m'
NC='\033[0m' # No Color

# -- Parse Arguments --
DELETE_MODE=false
VERSION=""
COMMENT="Maintenance release"

while [[ "$#" -gt 0 ]]; do
    case $1 in
        -d|--delete) DELETE_MODE=true; shift ;;
        *)
            if [ -z "$VERSION" ]; then
                VERSION="$1"
            elif [ "$COMMENT" = "Maintenance release" ]; then
                COMMENT="$1"
            fi
            shift
            ;;
    esac
done

if [ -z "$VERSION" ]; then
    echo -e "${RED}Error: Version parameter is required.${NC}"
    echo "Usage: ./publish-release.sh [next|preview|test|<version>] [\"comment\"] [-d]"
    exit 1
fi

# -- Paths --
SCRIPT_DIR="$( cd -- "$( dirname -- "${BASH_SOURCE[0]}" )" &> /dev/null && pwd )"
PKG_PATH="$SCRIPT_DIR/app/package.json"
YML_PATH="$SCRIPT_DIR/app/electron-builder.yml"

# -- Validate files exist --
if [ ! -f "$PKG_PATH" ]; then
    echo -e "${RED}app/package.json not found! Run script from the project root.${NC}"
    exit 1
fi
if [ ! -f "$YML_PATH" ]; then
    echo -e "${RED}app/electron-builder.yml not found!${NC}"
    exit 1
fi

# -- Version Helpers --
get_latest_version() {
    local latest_tag=$(git tag --sort=-v:refname | head -n 1)
    if [ -z "$latest_tag" ]; then
        echo -e "${YELLOW}No existing tags found. Starting from v0.1.0${NC}" >&2
        echo "0.1.0"
    else
        echo -e "${CYAN}Latest tag found: $latest_tag${NC}" >&2
        echo "${latest_tag#v}"
    fi
}

get_next_version() {
    local current_version=$1
    local clean_version=$(echo "$current_version" | sed 's/-.*//')
    
    if [[ $clean_version =~ ^([0-9]+)\.([0-9]+)\.([0-9]+)$ ]]; then
        local major="${BASH_REMATCH[1]}"
        local minor="${BASH_REMATCH[2]}"
        local patch="${BASH_REMATCH[3]}"
        patch=$((patch + 1))
        local next_version="${major}.${minor}.${patch}"
        echo -e "${GREEN}Next version: $next_version${NC}" >&2
        echo "$next_version"
    else
        echo -e "${RED}Invalid version format: $clean_version${NC}" >&2
        exit 1
    fi
}

# -- Mode Detection --
IS_TEST_MODE=false
IS_NEXT_MODE=false
IS_PREVIEW_MODE=false

if [ "$VERSION" = "test" ]; then
    echo -e "${MAGENTA}TEST MODE: Push code to CI (no tag, no release)${NC}"
    IS_TEST_MODE=true
    VERSION_NUM=$(get_latest_version)
    VERSION_TAG="v$VERSION_NUM"

elif [ "$VERSION" = "preview" ]; then
    echo -e "${YELLOW}PREVIEW MODE: Auto-increment + preview release${NC}"
    IS_PREVIEW_MODE=true
    current_version=$(get_latest_version)
    base_version=$(get_next_version "$current_version")
    VERSION_NUM="$base_version-preview"
    VERSION_TAG="v$base_version-preview"

elif [ "$VERSION" = "next" ]; then
    echo -e "${CYAN}NEXT MODE: Auto-increment patch version${NC}"
    IS_NEXT_MODE=true
    current_version=$(get_latest_version)

    if [[ "$current_version" == *-* ]]; then
        target_stable=$(echo "$current_version" | sed 's/-.*//')
        existing_stable=$(git tag -l "v$target_stable")
        if [ -n "$existing_stable" ]; then
            echo -e "${YELLOW}Stable v$target_stable already exists. Incrementing...${NC}"
            VERSION_NUM=$(get_next_version "$target_stable")
        else
            VERSION_NUM="$target_stable"
            echo -e "${YELLOW}Promoting preview -> stable: $VERSION_NUM${NC}"
        fi
    else
        VERSION_NUM=$(get_next_version "$current_version")
    fi
    VERSION_TAG="v$VERSION_NUM"

else
    if [[ "$VERSION" =~ ^v?([0-9]+\.[0-9]+\.[0-9]+)(-[a-zA-Z0-9]+)?$ ]]; then
        VERSION_NUM="${BASH_REMATCH[1]}${BASH_REMATCH[2]}"
        VERSION_TAG="v$VERSION_NUM"
    else
        echo -e "${RED}Invalid version format. Use e.g. '1.0.0', 'next', 'preview', 'test'.${NC}"
        exit 1
    fi
fi

# -- Delete Mode --
if [ "$DELETE_MODE" = true ]; then
    echo -e "${RED}DELETING tag: $VERSION_TAG${NC}"
    git tag -d "$VERSION_TAG" || true
    git push public --delete "$VERSION_TAG" || true
    echo -e "${GREEN}Tag $VERSION_TAG deleted.${NC}"
    exit 0
fi

# -- Print Banner --
if [ "$IS_TEST_MODE" = true ]; then MODE_STR="TEST";
elif [ "$IS_PREVIEW_MODE" = true ]; then MODE_STR="PREVIEW";
elif [ "$IS_NEXT_MODE" = true ]; then MODE_STR="NEXT (auto-increment)";
else MODE_STR="MANUAL"; fi

echo ""
echo "-------------------------------------------------"
echo -e "${WHITE}  ClawExpress Release Script${NC}"
echo -e "  Version : ${CYAN}$VERSION_TAG${NC}"
echo "  Comment : $COMMENT"
echo -e "  Mode    : ${YELLOW}$MODE_STR${NC}"
echo -e "  Publish to: ${GREEN}ClawKits/ClawExpress (public repo)${NC}"
echo "-------------------------------------------------"
echo ""

# 1. Update app/package.json
if [[ $(uname) == "Darwin" ]]; then
    sed -i '' -E 's/"version": "[^"]+"/"version": "'$VERSION_NUM'"/' "$PKG_PATH"
else
    sed -i -E 's/"version": "[^"]+"/"version": "'$VERSION_NUM'"/' "$PKG_PATH"
fi
echo -e "${GREEN}Updated app/package.json -> $VERSION_NUM${NC}"

# 2. Update app/electron-builder.yml
if [[ $(uname) == "Darwin" ]]; then
    sed -i '' -E 's/^( *version: )"[^"]+"/\1"'$VERSION_NUM'"/' "$YML_PATH"
else
    sed -i -E 's/^( *version: )"[^"]+"/\1"'$VERSION_NUM'"/' "$YML_PATH"
fi
echo -e "${GREEN}Updated app/electron-builder.yml -> $VERSION_NUM${NC}"

# 3. Git Operations
if [ "$IS_TEST_MODE" = true ]; then
    COMMIT_MSG="[TEST] $COMMENT"
elif [ "$IS_PREVIEW_MODE" = true ]; then
    COMMIT_MSG="[PREVIEW] $COMMENT"
else
    COMMIT_MSG="$COMMENT"
fi

echo -e "${YELLOW}Staging changes...${NC}"
git add .

echo -e "${YELLOW}Committing: $COMMIT_MSG${NC}"
git commit -m "$COMMIT_MSG" || true

echo -e "${YELLOW}Pushing to public main...${NC}"
git push public HEAD:main

if [ "$IS_TEST_MODE" = true ]; then
    echo ""
    echo -e "${GREEN}[OK] Code pushed! Monitor CI at:${NC}"
    echo -e "${BLUE}  https://github.com/ClawKits/ClawExpress/actions${NC}"
    echo ""
    echo -e "${YELLOW}If build passes, run:${NC}"
    echo -e "${CYAN}  ./publish-release.sh next \"$COMMENT\"${NC}"
    exit 0
fi

echo -e "${YELLOW}Creating tag $VERSION_TAG...${NC}"
git tag -a "$VERSION_TAG" -m "Release $VERSION_TAG - $COMMENT"

echo -e "${YELLOW}Pushing tag $VERSION_TAG...${NC}"
git push public "$VERSION_TAG"

echo ""
echo "-------------------------------------------------"
echo -e "${GREEN}  [OK] Release $VERSION_TAG triggered!${NC}"
echo "  GitHub Actions will now build for Win/Mac/Linux"
echo "  and publish to ClawKits/ClawExpress automatically."
echo ""
echo -e "${BLUE}  Monitor CI:  https://github.com/ClawKits/ClawExpress/actions${NC}"
echo -e "${BLUE}  Public repo: https://github.com/ClawKits/ClawExpress/releases${NC}"
echo "-------------------------------------------------"
