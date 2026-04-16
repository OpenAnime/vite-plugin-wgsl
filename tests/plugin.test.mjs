import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';

import wgslPlugin, { mangleTypescriptShaderStrings } from '../dist/index.js';

const shader = `
    fn helper(longName: vec4f) -> vec4f {
        let localValue = longName.rgb;
        return longName;
    }

    @fragment
    fn main(@location(0) color: vec4f) -> @location(0) vec4f {
        return helper(color);
    }
`;

describe('mangleTypescriptShaderStrings', () => {
    it('uses the TypeScript AST to transform matching shader declarations and assignments', () => {
        const dynamicTemplate = '`fn main(){${expr}}`';
        const code = [
            `export const VITE_SHADER_MAIN: string = ${JSON.stringify(shader)};`,
            'let VITE_SHADER_LATER;',
            `VITE_SHADER_LATER = ${JSON.stringify(shader)};`,
            `const VITE_SHADER_TEMPLATE = \`${shader}\`;`,
            `const VITE_SHADER_DYNAMIC = ${dynamicTemplate};`,
            `const VITE_SHADER_OBJ = { source: ${JSON.stringify(shader)} };`,
            `const OTHER = ${JSON.stringify(shader)};`,
        ].join('\n');

        const output = mangleTypescriptShaderStrings(code, {}, undefined, 'src/shaders.ts');

        assert.match(output, /VITE_SHADER_MAIN: string = "fn a\(/);
        assert.match(output, /VITE_SHADER_LATER = "fn a\(/);
        assert.match(output, /VITE_SHADER_TEMPLATE = "fn a\(/);
        assert.match(output, /VITE_SHADER_DYNAMIC = `fn main\(\)\{\$\{expr\}\}`/);
        assert.match(output, /VITE_SHADER_OBJ = \{ source: "\\n {4}fn helper/);
        assert.match(output, /const OTHER = "\\n {4}fn helper/);
    });

    it('supports a custom shader prefix', () => {
        const code = `const SHADER_MAIN = ${JSON.stringify(shader)};`;
        const output = mangleTypescriptShaderStrings(code, {}, 'SHADER_', 'src/shaders.ts');

        assert.match(output, /const SHADER_MAIN = "fn a\(/);
    });
});

describe('wgslPlugin', () => {
    it('passes through the Vite apply option', () => {
        const apply = (_config, env) => env.command === 'build';
        const buildOnlyPlugin = wgslPlugin({ include: '**/*.wgsl', apply: 'build' });
        const customApplyPlugin = wgslPlugin({ include: '**/*.wgsl', apply });

        assert.equal(buildOnlyPlugin.apply, 'build');
        assert.equal(customApplyPlugin.apply({}, { command: 'build', mode: 'production' }), true);
        assert.equal(customApplyPlugin.apply({}, { command: 'serve', mode: 'development' }), false);
    });

    it('transforms included TypeScript files and ignores non-matching ids', () => {
        const plugin = wgslPlugin({ include: 'src/**/*.ts' });
        const code = `const VITE_SHADER_MAIN = ${JSON.stringify(shader)};`;

        const transformed = plugin.transform?.(code, 'C:/project/src/shaders.ts');
        const skipped = plugin.transform?.(code, 'C:/project/other/shaders.ts');

        assert.ok(transformed && 'code' in transformed);
        assert.match(transformed.code, /VITE_SHADER_MAIN = "fn a\(/);
        assert.equal(skipped, null);
    });

    it('loads included WGSL files as minified default-export modules', async () => {
        const dir = await mkdtemp(path.join(tmpdir(), 'vite-plugin-wgsl-'));
        const file = path.join(dir, 'shader.wgsl');
        await writeFile(file, shader, 'utf8');

        try {
            const plugin = wgslPlugin({ include: '**/*.wgsl' });
            const loaded = await plugin.load?.(file);

            assert.equal(typeof loaded, 'string');
            assert.match(loaded, /^export default "fn a\(/);
            assert.doesNotMatch(loaded, /\blongName\b/);
        } finally {
            await rm(dir, { recursive: true, force: true });
        }
    });
});
