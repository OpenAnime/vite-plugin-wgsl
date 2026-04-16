# vite-plugin-wgsl

Minify and mangle WGSL shaders in Vite projects.

This plugin can process plain `.wgsl` files and WGSL strings embedded in TypeScript files. It removes comments and unnecessary whitespace, then safely renames a small set of local symbols.

## Installation

```
pnpm i vite-plugin-wgsl --save-dev
```

## Usage

Add the plugin to your Vite config:

```ts
// vite.config.ts
import { defineConfig } from 'vite';
import wgsl from 'vite-plugin-wgsl';

export default defineConfig({
    plugins: [
        wgsl({
            include: ['src/**/*.wgsl', 'src/**/*.ts'],
        }),
    ],
});
```

### WGSL files

Files ending in `.wgsl` are loaded as default-exported strings.

```wgsl
// src/shaders/triangle.wgsl
fn helper(color: vec4f) -> vec4f {
    let result = color.rgb;
    return vec4f(result, color.a);
}

@fragment
fn main(@location(0) color: vec4f) -> @location(0) vec4f {
    return helper(color);
}
```

```ts
import shader from './shaders/triangle.wgsl';

device.createShaderModule({ code: shader });
```

### TypeScript shader strings

For `.ts`, `.tsx`, `.mts`, and `.cts` files, the plugin parses the file with the `typescript` compiler API and only transforms string literals assigned to identifiers with the configured shader prefix.

The default prefix is `VITE_SHADER_`.

```ts
const VITE_SHADER_BLIT = `
    fn helper(color: vec4f) -> vec4f {
        let result = color.rgb;
        return vec4f(result, color.a);
    }

    @fragment
    fn main(@location(0) color: vec4f) -> @location(0) vec4f {
        return helper(color);
    }
`;
```

These forms are supported:

```ts
const VITE_SHADER_MAIN = `...`;
export const VITE_SHADER_MAIN: string = `...`;

let VITE_SHADER_MAIN;
VITE_SHADER_MAIN = `...`;
```

These are intentionally left unchanged:

```ts
const OTHER = `...`;
const VITE_SHADER_DYNAMIC = `fn main() { ${generatedBody} }`;
const VITE_SHADER_OBJECT = { source: `...` };
```

Interpolated template literals are skipped because the plugin cannot safely parse the final shader source at build time.

## Options

```ts
interface VitePluginWgslOptions {
    apply?: 'serve' | 'build' | ((config, env) => boolean);
    include: string | RegExp | Array<string | RegExp>;
    shaderPrefix?: string;
    renameFunctions?: boolean;
    renameParams?: boolean;
    renameLocals?: boolean;
    minify?: boolean;
}
```

### `apply`

Optional. Passed through to Vite's plugin `apply` field.

Use it to control whether the plugin runs during dev server, production build, or a custom condition:

```ts
wgsl({
    apply: 'build',
    include: ['src/**/*.wgsl', 'src/**/*.ts'],
});
```

```ts
wgsl({
    apply: (_config, env) => env.command === 'build',
    include: ['src/**/*.wgsl', 'src/**/*.ts'],
});
```

### `include`

Required. Selects which files the plugin should process.

```ts
wgsl({
    include: ['src/**/*.wgsl', 'src/**/*.ts'],
});
```

String patterns support `*`, `**`, `?`, and simple brace alternatives like `src/**/*.{ts,wgsl}`. `RegExp` patterns are also accepted.

### `shaderPrefix`

Defaults to `VITE_SHADER_`.

Use this when your embedded shader constants use a different naming convention:

```ts
wgsl({
    include: 'src/**/*.ts',
    shaderPrefix: 'SHADER_',
});
```

### Rename options

All rename passes are enabled by default.

```ts
wgsl({
    include: 'src/**/*.wgsl',
    renameFunctions: true,
    renameParams: true,
    renameLocals: true,
});
```

You can disable any pass:

```ts
wgsl({
    include: 'src/**/*.wgsl',
    renameFunctions: false,
});
```

### `minify`

Defaults to `true`.

Set `minify: false` to keep original whitespace/comments while still applying enabled renames.

```ts
wgsl({
    include: 'src/**/*.wgsl',
    minify: false,
});
```

## What Gets Renamed

This plugin is a conservative local mangler, not a full WGSL compiler.

It can rename:

- helper function names
- function parameters
- function-local `let`, `var`, and `const` declarations

It does not rename:

- `main`
- `@group`, `@binding`, `@location`, `@builtin`, and other attribute contents
- struct field names
- global resource names
- type names
- swizzles and field access after `.`, such as `.x`, `.xy`, `.rgb`, `.a`
- WGSL keywords and reserved words
- WGSL built-in function and type names

## Direct API

You can use the minifier without Vite:

```ts
import { mangleWgsl } from 'vite-plugin-wgsl';

const output = mangleWgsl(source, {
    renameFunctions: true,
    renameParams: true,
    renameLocals: true,
    minify: true,
});
```

You can also transform TypeScript source strings directly:

```ts
import { mangleTypescriptShaderStrings } from 'vite-plugin-wgsl';

const output = mangleTypescriptShaderStrings(sourceCode, {}, 'VITE_SHADER_', 'shader.ts');
```

## Development

```sh
npm test
```

The test command builds the package, runs the Node test suite, checks formatting, and runs ESLint.

```sh
npm run build
npm run lint
```

## Limits

This package deliberately avoids several harder WGSL transformations for now:

- struct type renaming
- struct field renaming
- type alias renaming
- global resource renaming
- `override` renaming
- custom preprocessor syntax
- interpolated shader template literals

The goal is a safe first pass for common local shader code, with predictable behavior.
