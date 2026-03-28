import { createLowlight } from 'lowlight'
import bash from 'highlight.js/lib/languages/bash'
import css from 'highlight.js/lib/languages/css'
import javascript from 'highlight.js/lib/languages/javascript'
import json from 'highlight.js/lib/languages/json'
import markdown from 'highlight.js/lib/languages/markdown'
import sql from 'highlight.js/lib/languages/sql'
import typescript from 'highlight.js/lib/languages/typescript'
import xml from 'highlight.js/lib/languages/xml'
import yaml from 'highlight.js/lib/languages/yaml'

export const lowlight = createLowlight()

lowlight.register('bash', bash)
lowlight.register('sh', bash)
lowlight.register('css', css)
lowlight.register('javascript', javascript)
lowlight.register('js', javascript)
lowlight.register('json', json)
lowlight.register('markdown', markdown)
lowlight.register('md', markdown)
lowlight.register('sql', sql)
lowlight.register('typescript', typescript)
lowlight.register('ts', typescript)
lowlight.register('html', xml)
lowlight.register('xml', xml)
lowlight.register('yaml', yaml)
lowlight.register('yml', yaml)
