
export class Ref {
    private static instance: Ref;


    public static getInstance(): Ref {
        if (!Ref.instance) {
            Ref.instance = new Ref();
        }
        return Ref.instance;
    }
}

// Create a global logger instance
export const logger = Ref.getInstance();