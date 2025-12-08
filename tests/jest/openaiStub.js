class OpenAIHarnessStub {
  constructor(config = {}) {
    this.config = config;
    this.chat = {
      completions: {
        create: async (args = {}) => {
          if (typeof global.fetch !== "function") {
            throw new Error("OpenAI harness stub requires global.fetch");
          }

          const response = await global.fetch("https://stubbed.openai", {
            method: "POST",
            headers: {
              "content-type": "application/json",
            },
            body: JSON.stringify(args),
          });

          if (!response || typeof response.json !== "function") {
            return {
              choices: [
                {
                  message: { content: "" },
                },
              ],
            };
          }

          return response.json();
        },
      },
    };
  }
}

module.exports = OpenAIHarnessStub;
