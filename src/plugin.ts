import { readFile } from 'node:fs/promises';

import ts from 'typescript';

import { type MangleOptions, mangleWgsl } from './minifier';

export type IncludePattern = string | RegExp;
export type PluginApply =
    | 'serve'
    | 'build'
    | ((config: unknown, env: { command: 'serve' | 'build'; mode: string }) => boolean);

export interface VitePluginWgslOptions extends MangleOptions {
    apply?: PluginApply;
    include: IncludePattern | IncludePattern[];
    shaderPrefix?: string;
}

interface VitePluginLike {
    name: string;
    apply?: PluginApply;
    enforce?: 'pre' | 'post';
    load?: (id: string) => Promise<string | null> | string | null;
    transform?: (
        code: string,
        id: string,
    ) => Promise<{ code: string; map: null } | null> | { code: string; map: null } | null;
}

const DEFAULT_SHADER_PREFIX = 'VITE_SHADER_';
const TS_EXTENSIONS = new Set(['.ts', '.tsx', '.mts', '.cts']);
const WGSL_EXTENSIONS = new Set(['.wgsl']);

interface Replacement {
    start: number;
    end: number;
    value: string;
}

function stripQuery(id: string): string {
    return id.split(/[?#]/, 1)[0];
}

function normalizeId(id: string): string {
    return stripQuery(id).replace(/\\/g, '/');
}

function extensionOf(id: string): string {
    const cleanId = stripQuery(id);
    const dot = cleanId.lastIndexOf('.');
    return dot === -1 ? '' : cleanId.slice(dot);
}

function escapeRegExp(value: string): string {
    return value.replace(/[|\\{}()[\]^$+?.]/g, '\\$&');
}

function globToRegExp(glob: string): RegExp {
    let pattern = '^';

    for (let i = 0; i < glob.length; i++) {
        const char = glob[i];
        const next = glob[i + 1];

        if (char === '*') {
            if (next === '*') {
                if (glob[i + 2] === '/') {
                    pattern += '(?:.*/)?';
                    i += 2;
                } else {
                    pattern += '.*';
                    i++;
                }
            } else {
                pattern += '[^/]*';
            }
            continue;
        }

        if (char === '?') {
            pattern += '[^/]';
            continue;
        }

        if (char === '{') {
            const end = glob.indexOf('}', i + 1);
            if (end !== -1) {
                const alternatives = glob
                    .slice(i + 1, end)
                    .split(',')
                    .map((part) => escapeRegExp(part));
                pattern += `(?:${alternatives.join('|')})`;
                i = end;
                continue;
            }
        }

        pattern += escapeRegExp(char);
    }

    pattern += '$';
    return new RegExp(pattern);
}

function normalizeIncludePattern(pattern: string): string {
    const normalized = pattern.replace(/\\/g, '/');
    const isAbsolute = normalized.startsWith('/') || /^[A-Za-z]:\//.test(normalized);
    const alreadyDeep = normalized.startsWith('**/');

    return isAbsolute || alreadyDeep ? normalized : `**/${normalized}`;
}

function createFilter(patterns: IncludePattern | IncludePattern[]): (id: string) => boolean {
    const list = Array.isArray(patterns) ? patterns : [patterns];
    const matchers = list.map((pattern) =>
        typeof pattern === 'string' ? globToRegExp(normalizeIncludePattern(pattern)) : pattern,
    );

    return (id: string) => {
        const normalized = normalizeId(id);
        return matchers.some((matcher) => matcher.test(normalized));
    };
}

function scriptKindFromId(id: string): ts.ScriptKind {
    return extensionOf(id) === '.tsx' ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
}

function isStaticStringLiteral(
    node: ts.Node,
): node is ts.StringLiteral | ts.NoSubstitutionTemplateLiteral {
    return ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node);
}

function literalReplacement(
    sourceFile: ts.SourceFile,
    literal: ts.StringLiteral | ts.NoSubstitutionTemplateLiteral,
    options: MangleOptions,
): Replacement {
    return {
        start: literal.getStart(sourceFile),
        end: literal.end,
        value: JSON.stringify(mangleWgsl(literal.text, options)),
    };
}

function applyReplacements(code: string, replacements: Replacement[]): string {
    if (replacements.length === 0) return code;

    const sorted = [...replacements].sort((a, b) => a.start - b.start);
    let out = '';
    let cursor = 0;

    for (const replacement of sorted) {
        if (replacement.start < cursor) continue;

        out += code.slice(cursor, replacement.start);
        out += replacement.value;
        cursor = replacement.end;
    }

    return out + code.slice(cursor);
}

export function mangleTypescriptShaderStrings(
    code: string,
    options: MangleOptions = {},
    shaderPrefix = DEFAULT_SHADER_PREFIX,
    id = 'shader.ts',
): string {
    const sourceFile = ts.createSourceFile(
        stripQuery(id),
        code,
        ts.ScriptTarget.Latest,
        true,
        scriptKindFromId(id),
    );
    const replacements: Replacement[] = [];

    const visit = (node: ts.Node): void => {
        if (
            ts.isVariableDeclaration(node) &&
            ts.isIdentifier(node.name) &&
            node.name.text.startsWith(shaderPrefix) &&
            node.initializer &&
            isStaticStringLiteral(node.initializer)
        ) {
            replacements.push(literalReplacement(sourceFile, node.initializer, options));
            return;
        }

        if (
            ts.isBinaryExpression(node) &&
            node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
            ts.isIdentifier(node.left) &&
            node.left.text.startsWith(shaderPrefix) &&
            isStaticStringLiteral(node.right)
        ) {
            replacements.push(literalReplacement(sourceFile, node.right, options));
            return;
        }

        ts.forEachChild(node, visit);
    };

    visit(sourceFile);

    return applyReplacements(code, replacements);
}

function toWgslModule(source: string, options: MangleOptions): string {
    return `export default ${JSON.stringify(mangleWgsl(source, options))};`;
}

export function wgslPlugin(options: VitePluginWgslOptions): VitePluginLike {
    const filter = createFilter(options.include);
    const shaderPrefix = options.shaderPrefix ?? DEFAULT_SHADER_PREFIX;
    const mangleOptions: MangleOptions = {
        minify: options.minify,
        renameFunctions: options.renameFunctions,
        renameLocals: options.renameLocals,
        renameParams: options.renameParams,
    };

    return {
        name: 'vite-plugin-wgsl',
        apply: options?.apply ?? 'build',
        async load(id) {
            if (!filter(id) || !WGSL_EXTENSIONS.has(extensionOf(id))) return null;
            return toWgslModule(await readFile(stripQuery(id), 'utf8'), mangleOptions);
        },
        transform(code, id) {
            if (!filter(id) || !TS_EXTENSIONS.has(extensionOf(id))) return null;

            const transformed = mangleTypescriptShaderStrings(
                code,
                mangleOptions,
                shaderPrefix,
                id,
            );

            return transformed === code ? null : { code: transformed, map: null };
        },
    };
}

export default wgslPlugin;
