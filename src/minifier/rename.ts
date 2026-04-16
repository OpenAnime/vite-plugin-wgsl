import { WGSL_ATTRIBUTE_NAMES, WGSL_BUILTINS } from './builtins';
import { WGSL_FORBIDDEN_IDENTIFIERS } from './keywords';
import {
    analyzeTokens,
    type FunctionInfo,
    nextSignificantIndex,
    previousSignificantIndex,
    type WgslAnalysis,
} from './parser';
import { Scope } from './scope';
import type { Token } from './tokenize';

export interface RenameOptions {
    renameFunctions?: boolean;
    renameParams?: boolean;
    renameLocals?: boolean;
}

const ALPHABET = 'abcdefghijklmnopqrstuvwxyz';

function shouldRenameFunctions(options: RenameOptions): boolean {
    return options.renameFunctions !== false;
}

function shouldRenameParams(options: RenameOptions): boolean {
    return options.renameParams !== false;
}

function shouldRenameLocals(options: RenameOptions): boolean {
    return options.renameLocals !== false;
}

function isTrivia(token: Token): boolean {
    return token.type === 'comment' || token.type === 'whitespace' || token.type === 'newline';
}

export function isRenameableIdentifier(token: Token, _prev?: Token, _next?: Token): boolean {
    if (token.type !== 'identifier') return false;
    if (token.followsDot) return false;
    if (WGSL_FORBIDDEN_IDENTIFIERS.has(token.value)) return false;
    if (WGSL_BUILTINS.has(token.value)) return false;
    if (WGSL_ATTRIBUTE_NAMES.has(token.value)) return false;
    if (token.value === 'main') return false;
    return true;
}

export function shortName(index: number): string {
    let s = '';
    let n = index;

    do {
        s = ALPHABET[n % 26] + s;
        n = Math.floor(n / 26) - 1;
    } while (n >= 0);

    return s;
}

function allocateName(scope: Scope, counter: { value: number }): string {
    while (true) {
        const name = shortName(counter.value++);
        if (
            !WGSL_FORBIDDEN_IDENTIFIERS.has(name) &&
            !WGSL_BUILTINS.has(name) &&
            !WGSL_ATTRIBUTE_NAMES.has(name) &&
            !scope.hasInChain(name)
        ) {
            return name;
        }
    }
}

function cloneTokenWithValue(token: Token, value: string): Token {
    return { ...token, value };
}

function markAttributeArguments(tokens: Token[]): Set<number> {
    const protectedIndices = new Set<number>();

    for (let i = 0; i < tokens.length; i++) {
        if (tokens[i].type !== 'attribute') continue;

        const open = nextSignificantIndex(tokens, i + 1);
        if (open === undefined || tokens[open].value !== '(') continue;

        let depth = 0;
        for (let j = open; j < tokens.length; j++) {
            const token = tokens[j];
            if (isTrivia(token)) continue;

            protectedIndices.add(j);
            if (token.value === '(') depth++;
            else if (token.value === ')') {
                depth--;
                if (depth === 0) break;
            }
        }
    }

    return protectedIndices;
}

function seedReservedNames(tokens: Token[], scope: Scope): void {
    for (const token of tokens) {
        if (token.type === 'identifier') scope.usedNames.add(token.value);
    }
}

function previousToken(tokens: Token[], index: number): Token | undefined {
    const prev = previousSignificantIndex(tokens, index - 1);
    return prev === undefined ? undefined : tokens[prev];
}

function nextToken(tokens: Token[], index: number): Token | undefined {
    const next = nextSignificantIndex(tokens, index + 1);
    return next === undefined ? undefined : tokens[next];
}

function isLocalDeclarationKeyword(token: Token): boolean {
    return (
        token.type === 'identifier' &&
        (token.value === 'let' || token.value === 'var' || token.value === 'const')
    );
}

function declarationNameAfter(tokens: Token[], keywordIndex: number): number | undefined {
    const keyword = tokens[keywordIndex];
    let cursor = nextSignificantIndex(tokens, keywordIndex + 1);

    if (keyword.value === 'var' && cursor !== undefined && tokens[cursor].value === '<') {
        let depth = 0;
        for (let i = cursor; i < tokens.length; i++) {
            const token = tokens[i];
            if (isTrivia(token)) continue;
            if (token.value === '<') depth++;
            else if (token.value === '>') {
                depth--;
                if (depth === 0) {
                    cursor = nextSignificantIndex(tokens, i + 1);
                    break;
                }
            }
        }
    }

    return cursor !== undefined && tokens[cursor].type === 'identifier' ? cursor : undefined;
}

function declareFunctionNames(
    tokens: Token[],
    analysis: WgslAnalysis,
    globalScope: Scope,
    replacements: Map<number, string>,
    counter: { value: number },
    options: RenameOptions,
): void {
    if (!shouldRenameFunctions(options)) return;

    for (const fn of analysis.functions) {
        const token = tokens[fn.nameTokenIndex];
        if (!isRenameableIdentifier(token) || token.value === 'main') continue;

        const mangled = allocateName(globalScope, counter);
        globalScope.declare(token.value, mangled);
        replacements.set(fn.nameTokenIndex, mangled);
    }
}

function declareParamNames(
    tokens: Token[],
    fn: FunctionInfo,
    functionScope: Scope,
    replacements: Map<number, string>,
    counter: { value: number },
    options: RenameOptions,
): void {
    if (!shouldRenameParams(options)) return;

    for (const tokenIndex of fn.paramTokenIndices) {
        const token = tokens[tokenIndex];
        if (!isRenameableIdentifier(token)) continue;

        const mangled = allocateName(functionScope, counter);
        functionScope.declare(token.value, mangled);
        replacements.set(tokenIndex, mangled);
    }
}

function applyFunctionRenames(
    tokens: Token[],
    fn: FunctionInfo,
    globalScope: Scope,
    replacements: Map<number, string>,
    counter: { value: number },
    protectedIndices: Set<number>,
    options: RenameOptions,
): void {
    const functionScope = new Scope(globalScope);
    const scopeStack = [functionScope];
    const skipIdentifierIndices = new Set<number>(fn.paramTokenIndices);

    declareParamNames(tokens, fn, functionScope, replacements, counter, options);

    for (let i = fn.bodyStartTokenIndex + 1; i < fn.bodyEndTokenIndex; i++) {
        const token = tokens[i];
        if (isTrivia(token)) continue;

        if (token.value === '{') {
            scopeStack.push(new Scope(scopeStack[scopeStack.length - 1]));
            continue;
        }

        if (token.value === '}') {
            if (scopeStack.length > 1) scopeStack.pop();
            continue;
        }

        const activeScope = scopeStack[scopeStack.length - 1];

        if (isLocalDeclarationKeyword(token)) {
            const declarationIndex = declarationNameAfter(tokens, i);
            if (declarationIndex !== undefined) {
                skipIdentifierIndices.add(declarationIndex);
                const declarationToken = tokens[declarationIndex];
                if (
                    shouldRenameLocals(options) &&
                    isRenameableIdentifier(declarationToken) &&
                    !protectedIndices.has(declarationIndex)
                ) {
                    const mangled = allocateName(activeScope, counter);
                    activeScope.declare(declarationToken.value, mangled);
                    replacements.set(declarationIndex, mangled);
                }
            }
            continue;
        }

        if (
            token.type !== 'identifier' ||
            protectedIndices.has(i) ||
            skipIdentifierIndices.has(i) ||
            !isRenameableIdentifier(token, previousToken(tokens, i), nextToken(tokens, i))
        ) {
            continue;
        }

        const resolved = activeScope.resolve(token.value);
        if (resolved !== undefined) replacements.set(i, resolved);
    }
}

export function applyRenames(
    tokens: Token[],
    analysis = analyzeTokens(tokens),
    options: RenameOptions = {},
): Token[] {
    const replacements = new Map<number, string>();
    const globalScope = new Scope();
    const counter = { value: 0 };
    const protectedIndices = markAttributeArguments(tokens);

    seedReservedNames(tokens, globalScope);
    declareFunctionNames(tokens, analysis, globalScope, replacements, counter, options);

    for (const fn of analysis.functions) {
        applyFunctionRenames(
            tokens,
            fn,
            globalScope,
            replacements,
            counter,
            protectedIndices,
            options,
        );
    }

    return tokens.map((token, index) => {
        const value = replacements.get(index);
        return value === undefined ? token : cloneTokenWithValue(token, value);
    });
}
