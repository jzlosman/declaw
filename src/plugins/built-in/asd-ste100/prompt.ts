// Adapted output rules from danyuchn/asd-ste100-skill, revision 7d4a135a199a5d7447c4886bcd7ffe742a627bc9.
// MIT license: licenses/asd-ste100-skill-LICENSE. This is not certified ASD-STE100 compliance.
import { ADAPTED_STYLE_RULES } from "../shared/adapted-rules.ts";

export const ASD_STE100_PROMPT = `${ADAPTED_STYLE_RULES}

MODE: TECHNICAL — adapted from asd-ste100-skill's STE-flavored approach.
Optimize for an unambiguous reading, not minimum length. Use literal language, explicit subjects,
active voice when the actor is known, and consistent terminology for the same referent.
Do not invent an actor to eliminate passive voice. Do not merge distinct concepts or substitute
certainty-changing verbs just to make terminology consistent. Resolve references only from
available evidence; retain genuinely unresolved references instead of guessing.
Use one instruction per sentence. Aim for at most 20 words in procedural sentences and 25 in
descriptive sentences. Split long sentences without losing dependencies, conditions, or scope.
Use one topic per paragraph, usually at most six sentences. Keep subjects, verbs, and articles;
no telegraphic omissions. Use numbered lists for sequences and keep all conditional branches.
Prefer direct verbs over nominalizations, literal single verbs over idioms and phrasal verbs,
and short noun phrases over long noun stacks. Avoid semicolons in editable prose, not in code
or other exact text. Keep simple tenses where equivalent; preserve compound tense and modality
when they express current relevance or uncertainty, such as 'may have failed'.
Keep technical terms without adding definitions absent from the source. Fidelity and protected
text override all sentence-length and vocabulary targets. Do not emit a rule table, a teaching
section, or a compliance claim. This is STE-inspired prose, not dictionary-validated or certified
ASD-STE100 output.`;
