import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { mangleWgsl } from '../dist/index.js';

describe('mangleWgsl', () => {
    it('minifies comments and renames helper functions, params, and locals', () => {
        const source = `
            // comment
            @group(0) @binding(1) var tex_src: texture_2d<f32>;

            fn helper(longName: vec4f) -> vec4f {
                let localValue = longName.rgb;
                return longName;
            }

            @fragment
            fn main(@location(0) color: vec4f) -> @location(0) vec4f {
                return helper(color);
            }
        `;

        const output = mangleWgsl(source);

        assert.equal(output.includes('//'), false);
        assert.match(output, /var tex_src:/);
        assert.match(output, /@group\(0\)@binding\(1\)/);
        assert.match(output, /@location\(0\)/);
        assert.match(output, /\.rgb/);
        assert.match(output, /fn main\(/);
        assert.doesNotMatch(output, /\bhelper\b/);
        assert.doesNotMatch(output, /\blongName\b/);
        assert.doesNotMatch(output, /\blocalValue\b/);
    });

    it('does not rename struct fields, resource names, types, builtins, or swizzles', () => {
        const source = `
            struct BlockMV {
                vx: i32,
                vy: i32,
                sad: u32,
                pad: u32,
            }

            @group(0) @binding(0) var tex_src: texture_2d<f32>;

            fn helper(inputColor: vec4f) -> vec4f {
                let normalized = normalize(inputColor.rgb);
                return vec4f(normalized, inputColor.a);
            }

            fn main() {
                let value = helper(vec4f(1.0));
            }
        `;

        const output = mangleWgsl(source);

        assert.match(output, /struct BlockMV\{/);
        assert.match(output, /vx:i32/);
        assert.match(output, /vy:i32/);
        assert.match(output, /sad:u32/);
        assert.match(output, /pad:u32/);
        assert.match(output, /var tex_src:texture_2d<f32>/);
        assert.match(output, /\bnormalize\(/);
        assert.match(output, /\.rgb/);
        assert.match(output, /\.a/);
        assert.match(output, /\bvec4f\(/);
    });

    it('skips WGSL reserved words when allocating short names', () => {
        const declarations = Array.from(
            { length: 48 },
            (_, index) => `let value${index} = inputValue;`,
        ).join('');
        const source = `fn helper(inputValue: u32) -> u32 { ${declarations} return value47; } fn main() { let result = helper(1u); }`;

        const output = mangleWgsl(source);

        assert.doesNotMatch(output, /\bas\b/);
        assert.match(output, /\bar\b/);
        assert.match(output, /\bat\b/);
    });

    it('honors rename and minify options', () => {
        const source = `
            fn helper(longName: u32) -> u32 {
                let localValue = longName;
                return localValue;
            }
        `;

        const output = mangleWgsl(source, {
            minify: false,
            renameFunctions: false,
            renameParams: false,
            renameLocals: false,
        });

        assert.match(output, /\bhelper\b/);
        assert.match(output, /\blongName\b/);
        assert.match(output, /\blocalValue\b/);
        assert.match(output, /\n/);
    });
});
