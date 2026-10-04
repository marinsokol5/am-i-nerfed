## Tenets

1. Personal   
    2. We are showing you results for your own model, from wherever the skill was invoked, with whatever reasoning effort you set. We don't believe in generic constant evaluation since there are various A/B tests running all the time, and separate behaviour per account (one can be throttled due to significant usage already, one can be whitelisted because of promotional reasons), direct API access vs agent (codex, claude code) access, different backends (anthropic vs bedrock) for the same model, or different bevaiour per time of the day (USA work hours are considered to be the busy period).
    3. The test cases are fully private and made specifically for you. Reionitilization produces different test cases. So model cannot peak on the result during training or look it up during thinking. Applying a learned reasoning method is legitimate success.
1. Quantifiable
    2. We present you with a number that tries to answer the question of "how intelligent is my model this morning".
    3. The number is literally "how correct is the model on my private reasoning test". It's not a universal intelligence score and cannot be compared against different models or users. The number also doesn't establish deliberate nerfing, a model swap, or part of an A/B experiment. 
1. Deterministic
    2. Generating test cases and evaluation should always be fully deterministic. 
1. Hidden
    2. We try to hide the result from the LLM by design.
1. Token budget aware
    2. We try to use as little tokens as possible while still providing a useful result. The idea is, around 1% of current Opus medium effort in Claude Code Pro account, per run.
1.  Reasoning
    2. We right now focus on reasoning/intelligence/deduction/understanding rather than knowledge or factual recall or design. We might introduce different types of evaluations in the future though.
    3. A sort of an IQ test for the model.
4. Throttle
    5. Accept one complete submission per run, with the grader enforcing that rule. Repeated scoring queries must not become a way to discover answers.

