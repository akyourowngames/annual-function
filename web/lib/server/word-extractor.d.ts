declare module "word-extractor" {
  class Document {
    getBody(): string;
    getFootnotes(): string;
    getEndnotes(): string;
    getHeaders(): string;
  }
  class WordExtractor {
    extract(input: Buffer | string): Promise<Document>;
  }
  export default WordExtractor;
}
