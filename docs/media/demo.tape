# `bun run demo`, recorded as it runs: the real CLI, mock responses, no network.
# Render with docs/media/demo.Dockerfile (instructions there).
Output docs/media/demo.gif

Set Shell "bash"
Set FontFamily "JetBrains Mono"
Set FontSize 13
Set Width 1280
Set Height 980
Set Padding 16
Set TypingSpeed 60ms
Set Theme "Catppuccin Mocha"

Hide
Type "export PS1='$ ' TMPDIR=/tmp && clear"
Enter
Show

Sleep 800ms
Type "bun run demo"
Sleep 500ms
Enter
Sleep 13s
