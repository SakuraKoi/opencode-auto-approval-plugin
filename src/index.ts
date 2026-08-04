export type GreetParams = {
  name: string;
  greeting?: string;
};

/**
 * Sample entry point. Replace with the real public API of your package.
 */
export const greet = ({ name, greeting = "Hello" }: GreetParams): string => {
  return `${greeting}, ${name}!`;
};
