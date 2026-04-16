import type { Token } from './tokenize';

export interface FunctionInfo {
    name: string;
    nameTokenIndex: number;
    paramTokenIndices: number[];
    bodyStartTokenIndex: number;
    bodyEndTokenIndex: number;
}

export interface DeclInfo {
    name: string;
    tokenIndex: number;
    kind: 'let' | 'var' | 'const' | 'param' | 'function';
}

export interface WgslAnalysis {
    functions: FunctionInfo[];
    declarations: DeclInfo[];
}

function isTrivia(token: Token): boolean {
    return token.type === 'comment' || token.type === 'whitespace' || token.type === 'newline';
}

export function nextSignificantIndex(tokens: Token[], start: number): number | undefined {
    for (let i = start; i < tokens.length; i++) {
        if (!isTrivia(tokens[i])) return i;
    }

    return undefined;
}

export function previousSignificantIndex(tokens: Token[], start: number): number | undefined {
    for (let i = start; i >= 0; i--) {
        if (!isTrivia(tokens[i])) return i;
    }

    return undefined;
}

function findMatchingToken(
    tokens: Token[],
    openIndex: number,
    openValue: string,
    closeValue: string,
): number | undefined {
    let depth = 0;

    for (let i = openIndex; i < tokens.length; i++) {
        const token = tokens[i];
        if (isTrivia(token)) continue;
        if (token.value === openValue) depth++;
        if (token.value === closeValue) {
            depth--;
            if (depth === 0) return i;
        }
    }

    return undefined;
}

function collectParamTokenIndices(
    tokens: Token[],
    paramsStart: number,
    paramsEnd: number,
): number[] {
    const params: number[] = [];
    let parenDepth = 0;
    let angleDepth = 0;

    for (let i = paramsStart + 1; i < paramsEnd; i++) {
        const token = tokens[i];
        if (isTrivia(token)) continue;

        if (token.value === '(') parenDepth++;
        else if (token.value === ')') parenDepth--;
        else if (token.value === '<') angleDepth++;
        else if (token.value === '>' && angleDepth > 0) angleDepth--;

        if (parenDepth !== 0 || angleDepth !== 0 || token.type !== 'identifier') {
            continue;
        }

        const next = nextSignificantIndex(tokens, i + 1);
        if (next !== undefined && tokens[next].value === ':') {
            params.push(i);
        }
    }

    return params;
}

function collectLocalDeclarations(tokens: Token[], bodyStart: number, bodyEnd: number): DeclInfo[] {
    const declarations: DeclInfo[] = [];

    for (let i = bodyStart + 1; i < bodyEnd; i++) {
        const token = tokens[i];
        if (
            token.type !== 'identifier' ||
            (token.value !== 'let' && token.value !== 'var' && token.value !== 'const')
        ) {
            continue;
        }

        let cursor = nextSignificantIndex(tokens, i + 1);
        if (token.value === 'var' && cursor !== undefined && tokens[cursor].value === '<') {
            const end = findMatchingToken(tokens, cursor, '<', '>');
            cursor = end === undefined ? undefined : nextSignificantIndex(tokens, end + 1);
        }

        if (cursor !== undefined && tokens[cursor].type === 'identifier') {
            declarations.push({
                name: tokens[cursor].value,
                tokenIndex: cursor,
                kind: token.value,
            });
        }
    }

    return declarations;
}

export function analyzeTokens(tokens: Token[]): WgslAnalysis {
    const functions: FunctionInfo[] = [];
    const declarations: DeclInfo[] = [];

    for (let i = 0; i < tokens.length; i++) {
        const token = tokens[i];
        if (token.type !== 'identifier' || token.value !== 'fn') continue;

        const nameTokenIndex = nextSignificantIndex(tokens, i + 1);
        if (nameTokenIndex === undefined || tokens[nameTokenIndex].type !== 'identifier') {
            continue;
        }

        const paramsStart = nextSignificantIndex(tokens, nameTokenIndex + 1);
        if (paramsStart === undefined || tokens[paramsStart].value !== '(') continue;

        const paramsEnd = findMatchingToken(tokens, paramsStart, '(', ')');
        if (paramsEnd === undefined) continue;

        let cursor = nextSignificantIndex(tokens, paramsEnd + 1);
        while (cursor !== undefined && tokens[cursor].value !== '{') {
            cursor = nextSignificantIndex(tokens, cursor + 1);
        }
        if (cursor === undefined) continue;

        const bodyStartTokenIndex = cursor;
        const bodyEndTokenIndex = findMatchingToken(tokens, bodyStartTokenIndex, '{', '}');
        if (bodyEndTokenIndex === undefined) continue;

        const paramTokenIndices = collectParamTokenIndices(tokens, paramsStart, paramsEnd);
        const fn: FunctionInfo = {
            name: tokens[nameTokenIndex].value,
            nameTokenIndex,
            paramTokenIndices,
            bodyStartTokenIndex,
            bodyEndTokenIndex,
        };

        functions.push(fn);
        declarations.push({
            name: fn.name,
            tokenIndex: fn.nameTokenIndex,
            kind: 'function',
        });
        for (const tokenIndex of paramTokenIndices) {
            declarations.push({
                name: tokens[tokenIndex].value,
                tokenIndex,
                kind: 'param',
            });
        }
        declarations.push(
            ...collectLocalDeclarations(tokens, bodyStartTokenIndex, bodyEndTokenIndex),
        );

        i = bodyEndTokenIndex;
    }

    return { functions, declarations };
}
