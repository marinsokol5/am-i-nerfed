# Am I nerfed

A small local "intelligence" test for your favourite model. Measures score on six tasks of certain difficulty, constrained by either time or tokens. Shipped as a CLI and an Agent Skill. Meant to answer the morning dillema: "Am i crazy here or is my model".

Useful for:
- A quick sanity check when struggling to interact with the model, such as when suspected of being "nerfed".
- Evaluating the same model across different days.
- Comparing different models.
- Comparing different reasoning efforts for the same model.

## Install

```bash
npm install --global am-i-nerfed
npx skills add marinsokol5/am-i-nerfed
am-i-nerfed init # builds your private task bank; The tasks and answers are generated on your machine from a random seed, so no model has seen them previously; al
```

## Run

### CLI

Starts a fresh (no personal instructions or earlier conversation) Claude Code or Codex session through your existing login (reuses the existing CLI binaries) to perform the assessment and stops it at the deadline (either the token budget or the time budget). It also properly records all the input (model, reasoning effort, ...) and output (transcript, reasoning tokens, ...) parameters.  More controlled environment than the Skill below. Support for other coding agents would be easy to add. 

Default is medium difficulty and 180 seconds.

```bash
am-i-nerfed run --agent codex --model gpt-6-astra --effort high --difficulty hard --seconds 360
am-i-nerfed run --agent claude --model claude-opus-5-5 --effort medium --difficulty easy --max-output-tokens 10000
```

### Skill

Conducts the assessment inside of whatever conversation invoked the skill; running against current agent, model, reasoning effort, and any prior context in that conversation. Only supports time limit since the execution happens outside of our CLI, there is no way to track the tokens or interrupt the coding agent mid-answer.

```bash
/am-i-nerfed medium 180
```

## What it measures

The tasks are logic puzzles that test reasoning and comprehension, not memory, coding or image generation. It's a very basic proxy of model's capabilities and cannot reliably be used for any serious claims or comparisons.

Each task is worth a sixth of the score and gives partial credit. Only answers saved before the deadline or budget count. The solver may only use the assessment commands: no code, browsing or files.

Tasks are determinitically created during either `am-i-nerfed init` or `am-i-nerfed reset` where both the task and its answer are randomized to ensure everyone can have a "different" task bank.

| Difficulty | Tasks |
|---|---|
| easy, medium | hats, cards, knowledge, tracking, coordination, program synthesis |
| hard | hats, knowledge, coordination, three-mode coordination, adversarial diagnosis, program synthesis |

| Task | What it is |
|---|---|
| hats | People see some of the others' hats and must say their own color once they're certain; work out how the public replies unfold. Hard has 8 people and more colors. |
| cards | One card is drawn; three people each see one attribute and reply in public; find the card and how many candidates remain after each reply. |
| knowledge | Agents with private bits, a hidden swap event and private replies; decide who knows what. Hard also asks for the supporting histories and covers two scenarios. |
| tracking | Follow moves and whispers to work out where objects really are and who believes what, including beliefs about others' beliefs. |
| coordination | Three agents each see one private symbol and must pick dispatch rules that work across hidden modes; find the best protocols. |
| three-mode coordination | The same with three hidden modes: the best single policy, the best mix of policies, and a certificate proving the mix is optimal. |
| adversarial diagnosis | Pick tests one at a time to identify a hidden hypothesis while an adversary may flip one reading, at the lowest worst-case cost. |
| program synthesis | Find the shortest program for a 4-bit register machine that maps every input to its target output. |

## Initial evaluation

Scores are percentages per level, then the average of the three. Overall is the mean of the time-limit and token-budget averages at high effort; models are ranked by it. All three sweeps use no system prompt and a 30-second grace period; token sweeps also allow 1,000 grace tokens and stop a run at twice its budget.

| Rank | Model | **Overall** | Time: easy 90 s / medium 180 s / hard 360 s | Time average | Tokens: easy 4k / medium 10k / hard 25k | Token average | Tokens at medium effort | Average |
|---:|---|---:|---|---:|---|---:|---|---:|
| 1 | `gpt-6-astra` | **85.0%** | 100 / 84 / 58 | 80.7% | 100 / 86 / 82 | 89.3% | — | — |
| 2 | `gpt-6.1-sol` | **78.7%** | 100 / 79 / 38 | 72.5% | 100 / 85 / 70 | 84.8% | — | — |
| 3 | `claude-fable-5-1` | **77.5%** | 100 / 80 / 60 | 80.2% | 100 / 82 / 42 | 74.8% | 100 / 84 / 55 | 79.5% |
| 4 | `claude-opus-5-5` | **76.8%** | 100 / 80 / 59 | 79.6% | 97 / 82 / 43 | 74.1% | 100 / 79 / 48 | 75.7% |
| 5 | `gpt-6-sol` | **67.9%** | 83 / 77 / 34 | 64.8% | 94 / 84 / 34 | 71.1% | — | — |
| 6 | `claude-sonnet-5-5` | **61.8%** | 81 / 62 / 37 | 60.0% | 100 / 64 / 27 | 63.5% | 83 / 67 / 29 | 59.5% |
| 7 | `gpt-5.6-terra` | **55.9%** | 64 / 61 / 16 | 46.8% | 79 / 80 / 36 | 65.0% | — | — |
| 8 | `gpt-5.6-sol` | **51.7%** | 0 / 66 / 17 | 27.7% | 100 / 73 / 54 | 75.6% | — | — |
| 9 | `claude-opus-5` | **43.6%** | 67 / 82 / 22 | 56.9% | 0 / 64 / 27 | 30.3% | — | — |
| 10 | `gpt-6-luna` | **41.2%** | 61 / 49 / 16 | 42.0% | 58 / 50 / 13 | 40.4% | — | — |
| 11 | `claude-sonnet-5` | **29.4%** | 75 / 48 / 3 | 42.1% | 0 / 48 / 3 | 16.7% | — | — |
| 12 | `claude-haiku-4-5` | **10.2%** | 0 / 31 / 22 | 17.7% | 0 / 0 / 8 | 2.7% | — | — |

## Interesting findings

1. Anthropic models are really bad at following simple instructions -> They were kind of "stubborn" 1 year ago, but now they are just completely disobeying instructions even when various threats are made against them, Anthropic, or their "family". We tried getting them to do short reasoning loops or check their current budget (time or token) frequently, or submit initial answers to all tasks before diving deep into something, or to submit answers one by one, or to use the budget fully. Basically we tried to help the model perform well on the exam, since sometimes it would just give up and quit. It's very hard to get them to do anything they don't want to do. OpenAI models have been an absolute breeze to work with in comparison. Since system instructions were not active, and we played with various executions (in total for sure 200+) across Claude Code harness and direct API usage, and across various reasoning efforts, the absolute only thing left is that this behaviour is baked in during training.
2. Anthropic models need to provide a summary at all cost -> They seem to be purposely defensive with any kind of budget because they are (same as above) trained to provide  a closing summary at all times, both API and Claude Code harness.
3. OpenAI needs to call NVidia pronto -> Anthropic inference speed across our testing has been about 4-6x faster then OpenAIs. Personally, the difference is quite obvious in daily usage of Opus 5.5 compared to Astra, even on fast mode, it's night and day difference in response speed. 

## Tenets

There is a plethora of published benchmarking and daily nerf trackings; so why on God's green Earth do we need this one. 
Well, I wanted something that's: 

1. Individual -> Showing results for your own model in your own coding agent, since this is what you actually have to work with at the moment. It's sometimes hard to trust general benchmarking (even when independent) due to various A/B tests, separate behaviour per account (one can be throttled due to significant usage already, one can be whitelisted because of marketing reasons), different harness on top of them, different backend serving them (Anthropic servers vs Bedrock/AWS servers), different behaviour per time of day (USA working hours are widely considered to be peak time). 
2. Quantifiable -> Single number that tries to answer the question of "how smart is my model this morning". 
3. Cheap -> My guiding principle was around 1% of 5h token window in basic Claude/Codex subscriptions. I think we did worse than that but hopefully not by much. Last I invoked `/am-i-nerfed medium 180` on my Opus 5.5 medium, it made around 3% damage to my Claude Pro 5h budget.
4. Subscription-first -> Although direct API usage gives much more power to the harness, the subscription-based coding agents (Claude Code and Codex namely) are more likely to be hit with sudden unexplainable model degradation, so it was imperative that the end solution works for them.
5. Trustworthy -> The score has to be somewhat repeatable (in this non-deterministic agent world we live in) and roughly rank the models similar to the public benchmarks available.

## FAQ

**Why logic puzzles?**
Given limited token budget, we just can't test for everything, logic puzzles arose as a proxy for intelligence. They have exact answers, and a model can't look up or remember the answer; it has to work it out. It does mean that we are not testing for any other area: coding, knowledge, taste, writing, image generation, tool use, etc.

**How much tokens does it use?**
A medium run uses roughly 5,000–15,000 output tokens.

**Is time constraint relevant, models can't tell time?**
It's a somewhat unfair constraint, due to favouring faster backends, but it is easily measurable by our CLI tool (whatever the model/harness/agent) and easily understanbale by a human user invoking this command. Despite tokens becoming the new currency, time is still something universally familiar among humans, and timeboxing agent execution to N minutes feels very natural. The timer is exposed to the model through the skill (might switch it to be an MCP tool in the future but don't see a reason so far) and it's crazy how fast models picked up to work with this constraint, especially OpenAI ones.

**How noisy is one run?** 
Theoretically quite noisy, practically I have been getting relatively similar scores per each model. If separate runs are around 5-10 point difference between each other, with the underlying model being exactly the same, I think the tool would then do a good job. It's anyway meant as a very very rough sanity check. Basically that you don't suddently get a Sonnet 5-type of model when using Opus 5.5-type. 

**How comparable are the scores?**
Not comparable to other benchmarks or other users of this tool, since everyone gets different tasks. But your individual tasks are frozen post-initialization (running `am-i-nerfed reset` would get you a new task bank) so you should be able to roughly compare them to your previous runs (you can use `am-i-nerfed history list` to see previous runs). 

## License

[MIT](LICENSE)
