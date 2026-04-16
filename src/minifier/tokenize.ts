export type TokenType =
    | 'identifier'
    | 'number'
    | 'string'
    | 'attribute'
    | 'operator'
    | 'punct'
    | 'newline'
    | 'comment'
    | 'whitespace';

export interface Token {
    type: TokenType;
    value: string;
    start: number;
    end: number;
    followsDot?: boolean;
}

const PUNCT = new Set(['(', ')', '{', '}', '[', ']', ';', ',', ':', '.']);
const MULTI_OPERATORS = [
    '>>=',
    '<<=',
    '->',
    '==',
    '!=',
    '<=',
    '>=',
    '&&',
    '||',
    '>>',
    '<<',
    '+=',
    '-=',
    '*=',
    '/=',
    '%=',
    '&=',
    '|=',
    '^=',
    '++',
    '--',
];
const OPERATOR_CHARS = new Set(['=', '+', '-', '*', '/', '%', '>', '<', '!', '&', '|', '^', '~']);

function isIdentifierStart(char: string): boolean {
    return /[A-Za-z_]/.test(char);
}

function isIdentifierPart(char: string): boolean {
    return /[A-Za-z0-9_]/.test(char);
}

function isDigit(char: string): boolean {
    return /[0-9]/.test(char);
}

function previousSignificantToken(tokens: Token[]): Token | undefined {
    for (let i = tokens.length - 1; i >= 0; i--) {
        const token = tokens[i];
        if (token.type !== 'whitespace' && token.type !== 'newline' && token.type !== 'comment') {
            return token;
        }
    }

    return undefined;
}

function readNumber(source: string, start: number): number {
    let i = start;

    if (source[i] === '0' && /[xX]/.test(source[i + 1] ?? '')) {
        i += 2;
        while (/[0-9A-Fa-f]/.test(source[i] ?? '')) i++;
    } else {
        while (isDigit(source[i] ?? '')) i++;
        if (source[i] === '.' && isDigit(source[i + 1] ?? '')) {
            i++;
            while (isDigit(source[i] ?? '')) i++;
        }
        if (/[eE]/.test(source[i] ?? '')) {
            let exponent = i + 1;
            if (/[+-]/.test(source[exponent] ?? '')) exponent++;
            if (isDigit(source[exponent] ?? '')) {
                i = exponent + 1;
                while (isDigit(source[i] ?? '')) i++;
            }
        }
    }

    if (/[iuftp]/i.test(source[i] ?? '')) {
        i++;
        while (/[0-9A-Za-z_]/.test(source[i] ?? '')) i++;
    }

    return i;
}

function readString(source: string, start: number): number {
    const quote = source[start];
    let i = start + 1;

    while (i < source.length) {
        if (source[i] === '\\') {
            i += 2;
            continue;
        }
        if (source[i] === quote) return i + 1;
        i++;
    }

    return i;
}

export function tokenizeWgsl(source: string): Token[] {
    const tokens: Token[] = [];
    let i = 0;

    while (i < source.length) {
        const start = i;
        const char = source[i];

        if (char === '\r' || char === '\n') {
            if (char === '\r' && source[i + 1] === '\n') i++;
            i++;
            tokens.push({ type: 'newline', value: source.slice(start, i), start, end: i });
            continue;
        }

        if (char === ' ' || char === '\t' || char === '\v' || char === '\f') {
            while (/[ \t\v\f]/.test(source[i] ?? '')) i++;
            tokens.push({
                type: 'whitespace',
                value: source.slice(start, i),
                start,
                end: i,
            });
            continue;
        }

        if (char === '/' && source[i + 1] === '/') {
            i += 2;
            while (i < source.length && source[i] !== '\n' && source[i] !== '\r') i++;
            tokens.push({ type: 'comment', value: source.slice(start, i), start, end: i });
            continue;
        }

        if (char === '/' && source[i + 1] === '*') {
            i += 2;
            while (i < source.length && !(source[i] === '*' && source[i + 1] === '/')) i++;
            i = Math.min(i + 2, source.length);
            tokens.push({ type: 'comment', value: source.slice(start, i), start, end: i });
            continue;
        }

        if (char === '"' || char === "'") {
            i = readString(source, start);
            tokens.push({ type: 'string', value: source.slice(start, i), start, end: i });
            continue;
        }

        if (char === '@' && isIdentifierStart(source[i + 1] ?? '')) {
            i += 2;
            while (isIdentifierPart(source[i] ?? '')) i++;
            tokens.push({ type: 'attribute', value: source.slice(start, i), start, end: i });
            continue;
        }

        if (isIdentifierStart(char)) {
            i++;
            while (isIdentifierPart(source[i] ?? '')) i++;
            const prev = previousSignificantToken(tokens);
            tokens.push({
                type: 'identifier',
                value: source.slice(start, i),
                start,
                end: i,
                followsDot: prev?.value === '.',
            });
            continue;
        }

        if (isDigit(char) || (char === '.' && isDigit(source[i + 1] ?? ''))) {
            i = readNumber(source, start);
            tokens.push({ type: 'number', value: source.slice(start, i), start, end: i });
            continue;
        }

        const multiOperator = MULTI_OPERATORS.find((operator) => source.startsWith(operator, i));
        if (multiOperator) {
            i += multiOperator.length;
            tokens.push({
                type: 'operator',
                value: multiOperator,
                start,
                end: i,
            });
            continue;
        }

        if (PUNCT.has(char)) {
            i++;
            tokens.push({ type: 'punct', value: char, start, end: i });
            continue;
        }

        if (OPERATOR_CHARS.has(char)) {
            i++;
            tokens.push({ type: 'operator', value: char, start, end: i });
            continue;
        }

        i++;
        tokens.push({ type: 'operator', value: char, start, end: i });
    }

    return tokens;
}
