import { relative, sep } from 'node:path'
import type { NodePath, PluginObj, types as BabelTypes } from '@babel/core'

// Babel plugin for the in-app Ref tool (src/components/RefMode.tsx): stamps every
// host element written in src/ with data-ref="Component · src/file.tsx:line", so a
// click in the running app names the exact JSX that drew it. Survives minification
// (it's an attribute, not a function name). Skips tests and elements that already
// carry a data-ref.
const isComponentName = (name: string | undefined) => !!name && /^[A-Z]/.test(name)

function enclosingComponent(path: NodePath): string {
  for (let p: NodePath | null = path.parentPath; p; p = p.parentPath) {
    const node = p.node
    if (node.type === 'FunctionDeclaration' && isComponentName(node.id?.name)) return node.id!.name
    if (node.type === 'VariableDeclarator' && node.id.type === 'Identifier' && isComponentName(node.id.name)) return node.id.name
  }
  return ''
}

export function refAttributes(root: string) {
  return ({ types: t }: { types: typeof BabelTypes }): PluginObj => ({
    name: 'nurav-ref-attributes',
    visitor: {
      JSXOpeningElement(path, state) {
        const filename = state.filename ?? ''
        const file = relative(root, filename).split(sep).join('/')
        if (!file.startsWith('src/') || /\.test\.tsx?$/.test(file)) return
        const { name, attributes, loc } = path.node
        if (name.type !== 'JSXIdentifier' || !/^[a-z]/.test(name.name)) return // host elements only
        if (attributes.some((a) => a.type === 'JSXAttribute' && a.name.name === 'data-ref')) return
        const component = enclosingComponent(path)
        const ref = `${component ? `${component} · ` : ''}${file}:${loc?.start.line ?? '?'}`
        attributes.push(t.jsxAttribute(t.jsxIdentifier('data-ref'), t.stringLiteral(ref)))
      },
    },
  })
}
