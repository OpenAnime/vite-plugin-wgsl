export class Scope {
    parent?: Scope;
    declarations = new Map<string, string>();
    usedNames = new Set<string>();

    constructor(parent?: Scope) {
        this.parent = parent;
    }

    hasInChain(name: string): boolean {
        if (this.usedNames.has(name)) return true;
        return this.parent ? this.parent.hasInChain(name) : false;
    }

    resolve(original: string): string | undefined {
        if (this.declarations.has(original)) return this.declarations.get(original);
        return this.parent?.resolve(original);
    }

    declare(original: string, mangled: string): void {
        this.declarations.set(original, mangled);
        this.usedNames.add(mangled);
    }
}
