import type { Token } from './tokenize';

const WORDY_TYPES = new Set(['identifier', 'number']);

function isTrivia(token: Token): boolean {
    return token.type === 'comment' || token.type === 'whitespace' || token.type === 'newline';
}

function wouldMergeIntoOperator(a: Token, b: Token): boolean {
    const combined = a.value + b.value;
    return [
        '->',
        '++',
        '--',
        '+=',
        '-=',
        '*=',
        '/=',
        '%=',
        '==',
        '!=',
        '<=',
        '>=',
        '&&',
        '||',
        '<<',
        '>>',
        '&=',
        '|=',
        '^=',
    ].includes(combined);
}

export function needsSpace(a: Token, b: Token): boolean {
    if (WORDY_TYPES.has(a.type) && WORDY_TYPES.has(b.type)) return true;
    if (a.type === 'attribute' && WORDY_TYPES.has(b.type)) return true;
    if (WORDY_TYPES.has(a.type) && b.type === 'attribute') return true;
    if (a.type === 'operator' && b.type === 'operator') return wouldMergeIntoOperator(a, b);
    if (a.value === '/' && (b.value === '/' || b.value === '*')) return true;
    if ((a.value === '+' && b.value === '+') || (a.value === '-' && b.value === '-')) {
        return true;
    }
    return false;
}

export function printTokens(tokens: Token[]): string {
    let out = '';
    let prev: Token | undefined;

    for (const token of tokens) {
        if (isTrivia(token)) continue;
        if (prev && needsSpace(prev, token)) out += ' ';
        out += token.value;
        prev = token;
    }

    return out;
}

export function tokensToReadableString(tokens: Token[]): string {
    return tokens.map((token) => token.value).join('');
}
