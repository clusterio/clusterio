declare module "getFactorioLocale" {
    interface callback {
        (error: Error, factorioLocale?: any): void
    }
    export function asObject(factorioDirectory: string, languageCode: string, callback: callback): void
}