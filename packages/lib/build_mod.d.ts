export interface BuildArgs {
    factorioVersion?: string;
    dependencies?: Record<string, string>;
    clean?: boolean;
    pack?: boolean;
    build?: boolean;
    outputDir: string;
    sourceDir: string;
};
export function build(args: BuildArgs): Promise<void>;
