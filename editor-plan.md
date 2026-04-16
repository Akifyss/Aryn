
# 需求
我需要新增一个支持 安装 vscode extension （vsix 文件） 的编辑器。
比如 
https://github.com/vadimmelnicuk/meo
https://marketplace.visualstudio.com/items?itemName=vadimmelnicuk.meo

btw，我把 Markdown Editor Optimized 的vsix 文件 放到了 public/extensions 文件夹下。

并且 此新增编辑器的diff view最好能够支持比较完整的 chunk diff action

当前应用的编辑器都保留。新增编辑器的入口，在 文件树中的 item 的 更多菜单中新增一个选项，编辑器以当前 tab viewMode形式打开。

