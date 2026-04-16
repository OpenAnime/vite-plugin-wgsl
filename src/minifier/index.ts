import { analyzeTokens } from './parser';
import { printTokens, tokensToReadableString } from './print';
import { applyRenames, type RenameOptions } from './rename';
import { tokenizeWgsl } from './tokenize';

export interface MangleOptions extends RenameOptions {
    minify?: boolean;
}

export function mangleWgsl(source: string, options: MangleOptions = {}): string {
    const tokens = tokenizeWgsl(source);
    const analysis = analyzeTokens(tokens);
    const renamed = applyRenames(tokens, analysis, options);

    return options.minify === false ? tokensToReadableString(renamed) : printTokens(renamed);
}

export { WGSL_ATTRIBUTE_NAMES, WGSL_BUILTINS } from './builtins';
export { WGSL_FORBIDDEN_IDENTIFIERS, WGSL_KEYWORDS, WGSL_RESERVED_WORDS } from './keywords';
export { analyzeTokens, type DeclInfo, type FunctionInfo, type WgslAnalysis } from './parser';
export { needsSpace, printTokens, tokensToReadableString } from './print';
export { applyRenames, isRenameableIdentifier, type RenameOptions, shortName } from './rename';
export { Scope } from './scope';
export { type Token, tokenizeWgsl, type TokenType } from './tokenize';
