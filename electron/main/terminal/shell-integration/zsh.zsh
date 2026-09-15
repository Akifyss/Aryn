# Give zsh its real config directory before any user/system startup file sees it.
# Defer hook installation to the first prompt, after zsh has loaded those files.
if [[ "$ARYN_ZSH_DIR_SET" == 1 ]]; then
  builtin export ZDOTDIR="$ARYN_ZSH_USER_DIR"
else
  builtin unset ZDOTDIR
fi
builtin typeset -g __aryn_nonce="$ARYN_ZSH_NONCE"
builtin unset ARYN_ZSH_USER_DIR ARYN_ZSH_DIR_SET ARYN_ZSH_NONCE

# Define bodies before sourcing user config; it can change aliases/parsing mode.
# Local emulation keeps user options (e.g. nounset/ksharrays) out of our hooks.
function __aryn_preexec {
  builtin emulate -L zsh
  builtin printf '\e]633;Aryn;%s;busy\a' "$__aryn_nonce"
}

function __aryn_line_init {
  builtin emulate -L zsh
  # ZLE also runs for vared, select and continuation prompts. Only a top-level
  # command line is idle, including when a user's precmd hook opens a reader.
  if [[ $CONTEXT == start ]] && (( ZSH_SUBSHELL == 0 )); then
    builtin printf '\e]633;Aryn;%s;idle\a' "$__aryn_nonce"
  else
    builtin printf '\e]633;Aryn;%s;unknown\a' "$__aryn_nonce"
  fi
}

function __aryn_line_finish {
  builtin emulate -L zsh
  builtin printf '\e]633;Aryn;%s;unknown\a' "$__aryn_nonce"
}

function __aryn_install {
  [[ -o interactive && -o rcs && -o zle ]] || return 0
  builtin emulate -L zsh
  builtin autoload -Uz add-zsh-hook add-zle-hook-widget
  add-zsh-hook -d precmd __aryn_install
  if builtin zmodload zsh/zle; then
    # Standard helpers compose with existing prompt functions and widgets.
    add-zsh-hook preexec __aryn_preexec
    add-zle-hook-widget line-init __aryn_line_init
    add-zle-hook-widget line-finish __aryn_line_finish
  fi
  builtin unfunction __aryn_install
}

function __aryn_register {
  [[ -o interactive && -o rcs ]] || return 0
  builtin emulate -L zsh
  builtin typeset -ga precmd_functions
  precmd_functions+=(__aryn_install)
}

# This compound command is parsed before .zshenv can switch to sh emulation.
# Source at top level to preserve the scope of user typesets, functions and options.
{
  [[ ! -r "${ZDOTDIR-$HOME}/.zshenv" ]] || builtin source "${ZDOTDIR-$HOME}/.zshenv"
} always {
  __aryn_register
  builtin unfunction __aryn_register
}
