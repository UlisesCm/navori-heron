# navori:managed start id="tgrep-script-guard-search-routing" hash="35276308" version="0.11.1" source="@navori/plugin-tgrep"
#!/usr/bin/env bash
# Search-routing lane for the tgrep plugin (spec 0039 D6, R29-R31).
#
# SOURCED, never executed: `guard-destructive.sh` runs it in a subshell,
# `( . .claude/scripts/guard-search-routing.sh )`, from a managed sub-block placed
# after every destructive rule. `$cmd` is already parsed and in scope. The
# subshell isolates this file: a syntax error, an unset variable or a crash here
# exits with something other than 42 and the command is allowed.
#
# Exit contract (read by the sub-block):
#   42  block: the remedy is already on stderr.
#   43  allow with verdict `fail-open`: the guard would have blocked but tgrep is
#       missing or has no index (R31), so the shell search stays available.
#   *   allow.
#
# WHAT IT BLOCKS: a segment that STARTS a command (never one after a pipe) and
# invokes `grep`/`egrep`/`fgrep` recursively, or `rg` with no concrete file
# target. It redirects to `tgrep search` and to nothing else (R29).
#
# WHAT IT LETS THROUGH (R30), because a false block teaches the model to route
# AROUND the guard: output filtering after a pipe, extraction from an already
# known file, a ROOT outside the repo, a heredoc body, a command over 20k
# characters, `rg --files`/`--version`/`--help`, anything it cannot parse.
# `git grep` is NOT matched (D6 drops that rule).
navori_repo_root="${CLAUDE_PROJECT_DIR:-$PWD}"

if [ -z "${cmd:-}" ]; then exit 0; fi

# INERT CONTENT: a heredoc body is DATA, not a call.
case "$cmd" in *"<<"*) exit 0 ;; esac

# BOUNDED WORK: a command past the ceiling is allowed rather than inspected.
if [ "${#cmd}" -gt 20000 ]; then exit 0; fi

# SEGMENTS. Each rule only matches WITHIN one segment, and a segment carries
# whether it starts a command (`@C@` or the first line) or continues a pipe
# (`@P@`). `||` is rewritten before `|`; separators inside quotes are data.
segments=$(printf '%s' "$cmd" \
  | sed -e ':a' -e '$!N' -e 's/\\\n/ /' -e 'ta' -e 'P' -e 'D' \
  | awk '
    {
      line = $0
      out = ""
      inq = ""      # "", "\047" (single) or "\042" (double)
      n = length(line)
      for (i = 1; i <= n; i++) {
        c = substr(line, i, 1)
        if (inq == "") {
          if (c == "\047" || c == "\042") { inq = c; out = out c; continue }
          # `||` before `|`, or the first pipe of a `||` starts a bogus segment.
          if (c == "|" && substr(line, i + 1, 1) == "|") { out = out "\n@C@"; i++; continue }
          if (c == "&" && substr(line, i + 1, 1) == "&") { out = out "\n@C@"; i++; continue }
          if (c == ";") { out = out "\n@C@"; continue }
          if (c == "|") { out = out "\n@P@"; continue }
          out = out c
          continue
        }
        # Inside a quoted span every separator is DATA. The span ends only on
        # its own quote character, which is what keeps `"a ; b"` whole while
        # `'"'"'a'"'"' ; b` still splits.
        if (c == inq) inq = ""
        out = out c
      }
      printf "%s", out
    }
  ')

# Does this segment name at least ONE concrete file among its TARGET operands?
#
# This is the difference between searching the repo and reading files you have
# already found, and it cannot be read off the flags: `grep -rn "oxlint"
# apps/a/package.json apps/b/package.json` carries `-r` and is pure extraction —
# grep ignores recursion once you hand it files. Blocking that shape cost a real
# session a round-trip for nothing, and it is 9.3% of every recursive grep in the
# park (124 of 1,328), concentrated on reading single files under `node_modules/`.
#
# ONE file is enough to allow, not all of them: this guard fails open by design,
# and a mixed `src/ extra.ts` is more likely a reader being sloppy than a search
# worth a round-trip.
#
# The first non-flag operand is the PATTERN and is skipped — otherwise
# `grep -rn "config.json" src/` would look like it names a file when what it
# names is what it is looking FOR.
#
# An extension is NOT what makes something a file (#721 A3). Defining it that way
# blocked `rg foo Makefile`, `rg TODO Dockerfile`, `grep -rn foo LICENSE` and
# `grep -rn x CODEOWNERS` — all verified, all pure extraction from one named
# file, all exactly the shape this function exists to let through. So the awk
# below no longer decides: it PRINTS the target operands and the shell answers
# with three signals, cheapest first.
names_a_file() {
  navori_operands=$(printf '%s' "$1" | awk '
    {
      seen_pattern = 0
      for (i = 2; i <= NF; i++) {
        t = $i
        if (substr(t, 1, 1) == "-") continue
        if (!seen_pattern) { seen_pattern = 1; continue }
        gsub(/^["'"'"']+|["'"'"']+$/, "", t)
        if (t ~ /\*/) continue
        if (t ~ /\/$/) continue
        print t
      }
    }
  ')
  [ -n "$navori_operands" ] || return 1

  while IFS= read -r navori_operand; do
    [ -n "$navori_operand" ] || continue

    # 0. A ROOT outside the repo (`~/.claude/...`, `/tmp/...`) is not a repo
    #    search and the tgrep index cannot serve it (D6): allow.
    case "$navori_operand" in
      "~"|"~/"*) return 0 ;;
      /*)
        case "$navori_operand" in
          "$navori_repo_root"|"$navori_repo_root"/*) ;;
          *) return 0 ;;
        esac
        ;;
    esac

    # 1. An extension still answers most of them, and costs nothing.
    case "$navori_operand" in
      *.[A-Za-z0-9] | *.[A-Za-z0-9][A-Za-z0-9] | *.[A-Za-z0-9][A-Za-z0-9][A-Za-z0-9] | \
        *.[A-Za-z0-9][A-Za-z0-9][A-Za-z0-9][A-Za-z0-9]) return 0 ;;
    esac

    # 2. The files a repo keeps without one. Not a taste list: these are the
    #    names that appear at a repo root, so a search naming one is naming a
    #    file and not a tree.
    navori_base=${navori_operand##*/}
    case "$navori_base" in
      Makefile | makefile | GNUmakefile | Dockerfile | dockerfile | Containerfile | \
        LICENSE | LICENCE | COPYING | NOTICE | AUTHORS | CONTRIBUTORS | CODEOWNERS | \
        README | CHANGELOG | TODO | VERSION | Procfile | Gemfile | Rakefile | Brewfile | \
        Jenkinsfile | Vagrantfile | Caddyfile | Justfile | justfile | Taskfile | Podfile)
        return 0
        ;;
    esac

    # 3. Whatever is left, ask the filesystem — the only signal that settles
    #    `bin/deploy` (a script) against `src` (a tree) without guessing from
    #    the shape. A stat per operand, and there are at most a handful.
    [ -f "$navori_operand" ] && return 0
  done <<NAVORI_OPERANDS
$navori_operands
NAVORI_OPERANDS

  return 1
}


# Remedy, printed only on the branch that blocks. `tgrep status` runs here and
# nowhere else, so the common path pays nothing.
search_block() {
  navori_flags="-n"
  if ! command -v tgrep >/dev/null 2>&1; then exit 43; fi
  navori_status=$(tgrep status 2>&1) || exit 43
  case "$navori_status" in
    *"No index found"*) exit 43 ;;
    *Server:*"not running"*) navori_flags="-n --no-index" ;;
  esac
  echo "[navori] BLOCKED by guard-search-routing: $1" >&2
  echo "[navori] route content search through tgrep:" >&2
  echo "[navori]   tgrep search $navori_flags -- PATTERN ROOT" >&2
  echo "[navori] -i -l -w -F mean the same as in ripgrep; see 'tgrep search --help' for the rest." >&2
  echo "[navori] exit contract: 0 = match, 1 = no match, 2 = NOTHING WAS SEARCHED." >&2
  echo "[navori] this does NOT apply to '| grep' (filtering output) nor to" >&2
  echo "[navori] 'grep -n x known-file' (extracting from a file you already found)." >&2
  exit 42
}

starts=$(printf '%s\n' "$segments" | sed -n -e 's/^@C@//p' -e '1{/^@[CP]@/!p;}')

while IFS= read -r seg; do
  [ -n "$seg" ] || continue

  # Peel `VAR=value` prefixes so the verb anchor below sees the real command
  # (#724 B2). `LC_ALL=C grep -rn foo src/` evaded every rule here by sitting
  # one token to the right of the anchor — verified: exit 0 against exit 2 for
  # the same command without the prefix.
  #
  # Parameter expansion, not a `sed` fork: this runs once per segment next to
  # two `grep -qE` forks that are already there, and a heredoc is many segments.
  # The idiom is the one `gate-trigger.sh` uses (its FIX C) and it is the third
  # place this peel lives — `guard-destructive.sh` does it with a sed loop and
  # `parse.ts`'s `leadingBinary` in TypeScript. A fourth earns a shared partial.
  seg="${seg#"${seg%%[![:space:]]*}"}"
  while [[ "$seg" =~ ^[A-Za-z_][A-Za-z0-9_]*= ]]; do
    case "$seg" in
      *[[:space:]]*)
        seg="${seg#*[[:space:]]}"
        seg="${seg#"${seg%%[![:space:]]*}"}"
        ;;
      *) seg=""; break ;;
    esac
  done
  [ -n "$seg" ] || continue

  # Recursive grep: the flag may sit anywhere among the options.
  if printf '%s' "$seg" | grep -qE '^[[:space:]]*(grep|egrep|fgrep)([[:space:]]|$)' \
    && printf '%s' "$seg" | grep -qE '(^|[[:space:]])(-[a-zA-Z]*[rR][a-zA-Z]*|--recursive)([[:space:]]|=|$)' \
    && ! names_a_file "$seg"; then
    search_block "recursive content search through the shell"
  fi

  # `rg` is recursive by DEFAULT, so it is extraction only when a concrete file
  # (or a ROOT outside the repo) is named. `--files`, `--version` and `--help`
  # search no content at all.
  if printf '%s' "$seg" | grep -qE '^[[:space:]]*rg([[:space:]]|$)' \
    && ! printf '%s' "$seg" | grep -qE '(^|[[:space:]])(--files|--version|--help)([[:space:]]|$)' \
    && ! names_a_file "$seg"; then
    search_block "content search through the shell (rg is recursive by default)"
  fi
done <<EOF
$starts
EOF

exit 0
# navori:managed end id="tgrep-script-guard-search-routing"
