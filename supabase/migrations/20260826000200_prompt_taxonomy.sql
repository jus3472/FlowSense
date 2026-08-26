-- Extends the practice schema migration with a durable prompt library. The
-- taxonomy is attached to existing rows by text so past attempts keep their
-- prompt snapshots and newly applied environments remain idempotent.

with catalog (text, mode, difficulty, target_duration_seconds, collection_id) as (
  values
    ('Describe your ideal weekend.', 'practice', 'easy', 30, 'storytelling'),
    ('Explain how to make something you cook often.', 'practice', 'easy', 45, 'explanation'),
    ('Talk about a place you would like to visit.', 'practice', 'easy', 30, 'spontaneous_description'),
    ('What is something you changed your mind about?', 'practice', 'medium', 45, 'opinion'),
    ('Describe your hometown to someone who has never been there.', 'practice', 'medium', 45, 'spontaneous_description'),
    ('Explain something you are good at to a complete beginner.', 'practice', 'medium', 45, 'explanation'),
    ('What advice would you give your younger self?', 'practice', 'medium', 45, 'persuasion'),
    ('Describe a trip that did not go as planned.', 'practice', 'medium', 60, 'storytelling'),
    ('Talk about a song you keep coming back to.', 'practice', 'easy', 30, 'opinion'),
    ('Explain the rules of a game you know well.', 'practice', 'medium', 45, 'explanation'),
    ('Describe the last thing that made you laugh.', 'practice', 'easy', 30, 'storytelling'),
    ('Talk about a habit you picked up in the last year.', 'practice', 'easy', 30, 'storytelling'),
    ('What would you do with a free afternoon and no plans?', 'practice', 'easy', 30, 'opinion'),
    ('Describe a meal you still remember clearly.', 'practice', 'easy', 30, 'spontaneous_description'),
    ('Explain how you decide what to watch or read next.', 'practice', 'medium', 45, 'explanation'),
    ('Talk about someone who taught you something useful.', 'practice', 'medium', 45, 'storytelling'),
    ('Describe the room you are sitting in right now.', 'practice', 'easy', 30, 'spontaneous_description'),
    ('What is a small thing that makes your day better?', 'practice', 'easy', 30, 'opinion'),
    ('Talk about a skill you tried and did not stick with.', 'practice', 'medium', 45, 'storytelling'),
    ('Explain how you would spend a week in a city you love.', 'practice', 'hard', 60, 'persuasion'),

    ('Explain how you get ready for an ordinary day.', 'practice', 'easy', 30, 'explanation'),
    ('Describe an object near you without naming it until the end.', 'practice', 'medium', 45, 'spontaneous_description'),
    ('Tell a story about a small plan that changed at the last minute.', 'practice', 'medium', 45, 'storytelling'),
    ('Choose between eating at home and eating out, then persuade a friend to try your choice.', 'practice', 'hard', 60, 'persuasion'),

    ('Tell me about yourself and what brought you to this opportunity.', 'interview', 'easy', 45, 'background'),
    ('Describe a time you learned a useful lesson from someone else.', 'interview', 'easy', 45, 'behavioral'),
    ('What kind of work or activity keeps you interested, and why?', 'interview', 'easy', 30, 'motivation'),
    ('Tell me about a time you had two different ideas from someone you worked with.', 'interview', 'medium', 60, 'conflict'),
    ('Describe something you tried that did not work. What did you do next?', 'interview', 'medium', 60, 'failure'),
    ('Tell me about a time you helped a group move forward.', 'interview', 'medium', 60, 'leadership'),
    ('Describe a problem with no obvious answer and how you approached it.', 'interview', 'hard', 60, 'problem_solving'),
    ('Tell me about a time you had to choose between two reasonable options.', 'interview', 'hard', 60, 'problem_solving'),
    ('What would you want to learn in your next role or responsibility?', 'interview', 'medium', 45, 'motivation'),
    ('Describe a time you received feedback you did not expect.', 'interview', 'hard', 60, 'behavioral'),
    ('Tell me about a time you had to rebuild trust after a misunderstanding.', 'interview', 'hard', 60, 'conflict'),
    ('Describe a time you took responsibility when a plan went wrong.', 'interview', 'medium', 60, 'failure'),

    ('Explain an everyday idea, such as why a routine helps, to a mixed audience.', 'presentation', 'easy', 45, 'explain_idea'),
    ('Give a short pitch for a small change that would improve a shared space.', 'presentation', 'easy', 45, 'pitch'),
    ('Summarize a book, show, or event for someone deciding whether to try it.', 'presentation', 'easy', 45, 'summarize'),
    ('Teach a beginner how to do a familiar task in clear steps.', 'presentation', 'medium', 60, 'teach'),
    ('Persuade a group to choose one simple plan for a free afternoon.', 'presentation', 'medium', 60, 'persuade'),
    ('Recommend one option from two familiar choices and explain your criteria.', 'presentation', 'medium', 60, 'defend_recommendation'),
    ('Explain why a small daily habit can make a practical difference.', 'presentation', 'medium', 45, 'explain_idea'),
    ('Pitch an event that would help neighbors get to know one another.', 'presentation', 'hard', 60, 'pitch'),
    ('Summarize two sides of a familiar debate before stating your view.', 'presentation', 'hard', 60, 'summarize'),
    ('Teach someone how to make a decision when they have limited time.', 'presentation', 'hard', 60, 'teach'),
    ('Persuade a group to keep a useful tradition even when it takes effort.', 'presentation', 'hard', 60, 'persuade'),
    ('Defend your recommendation for changing a shared routine when others prefer the current one.', 'presentation', 'hard', 60, 'defend_recommendation'),

    ('Disagree with a friend who wants to skip planning and decide everything at the last minute.', 'conversation', 'easy', 45, 'disagreement'),
    ('Give kind, specific feedback to a friend who keeps arriving late.', 'conversation', 'easy', 45, 'giving_feedback'),
    ('Ask follow-up questions when someone gives you unclear directions.', 'conversation', 'easy', 30, 'asking_clarification'),
    ('Raise a concern about a shared plan that may leave someone out.', 'conversation', 'medium', 60, 'raising_concern'),
    ('Set a boundary when a friend asks you to answer messages late at night.', 'conversation', 'medium', 45, 'setting_boundary'),
    ('Explain why you chose a quieter plan when others wanted something busy.', 'conversation', 'medium', 45, 'explaining_decision'),
    ('Disagree with someone who thinks a quick answer is always better than a careful one.', 'conversation', 'medium', 60, 'disagreement'),
    ('Give feedback to a group member whose interruptions make it hard to talk.', 'conversation', 'hard', 60, 'giving_feedback'),
    ('Ask for clarification after someone changes the plan without explaining why.', 'conversation', 'medium', 45, 'asking_clarification'),
    ('Raise a concern when a friend shares something about you without asking first.', 'conversation', 'hard', 60, 'raising_concern'),
    ('Set a boundary with someone who repeatedly changes plans after you have agreed.', 'conversation', 'hard', 60, 'setting_boundary'),
    ('Explain a decision to leave a group activity when the timing no longer works for you.', 'conversation', 'hard', 60, 'explaining_decision')
)
update public.prompts as prompt
set
  mode = catalog.mode,
  difficulty = catalog.difficulty,
  target_duration_seconds = catalog.target_duration_seconds,
  collection_id = catalog.collection_id
from catalog
where prompt.text = catalog.text;

with catalog (text, mode, difficulty, target_duration_seconds, collection_id) as (
  values
    ('Explain how you get ready for an ordinary day.', 'practice', 'easy', 30, 'explanation'),
    ('Describe an object near you without naming it until the end.', 'practice', 'medium', 45, 'spontaneous_description'),
    ('Tell a story about a small plan that changed at the last minute.', 'practice', 'medium', 45, 'storytelling'),
    ('Choose between eating at home and eating out, then persuade a friend to try your choice.', 'practice', 'hard', 60, 'persuasion'),
    ('Tell me about yourself and what brought you to this opportunity.', 'interview', 'easy', 45, 'background'),
    ('Describe a time you learned a useful lesson from someone else.', 'interview', 'easy', 45, 'behavioral'),
    ('What kind of work or activity keeps you interested, and why?', 'interview', 'easy', 30, 'motivation'),
    ('Tell me about a time you had two different ideas from someone you worked with.', 'interview', 'medium', 60, 'conflict'),
    ('Describe something you tried that did not work. What did you do next?', 'interview', 'medium', 60, 'failure'),
    ('Tell me about a time you helped a group move forward.', 'interview', 'medium', 60, 'leadership'),
    ('Describe a problem with no obvious answer and how you approached it.', 'interview', 'hard', 60, 'problem_solving'),
    ('Tell me about a time you had to choose between two reasonable options.', 'interview', 'hard', 60, 'problem_solving'),
    ('What would you want to learn in your next role or responsibility?', 'interview', 'medium', 45, 'motivation'),
    ('Describe a time you received feedback you did not expect.', 'interview', 'hard', 60, 'behavioral'),
    ('Tell me about a time you had to rebuild trust after a misunderstanding.', 'interview', 'hard', 60, 'conflict'),
    ('Describe a time you took responsibility when a plan went wrong.', 'interview', 'medium', 60, 'failure'),
    ('Explain an everyday idea, such as why a routine helps, to a mixed audience.', 'presentation', 'easy', 45, 'explain_idea'),
    ('Give a short pitch for a small change that would improve a shared space.', 'presentation', 'easy', 45, 'pitch'),
    ('Summarize a book, show, or event for someone deciding whether to try it.', 'presentation', 'easy', 45, 'summarize'),
    ('Teach a beginner how to do a familiar task in clear steps.', 'presentation', 'medium', 60, 'teach'),
    ('Persuade a group to choose one simple plan for a free afternoon.', 'presentation', 'medium', 60, 'persuade'),
    ('Recommend one option from two familiar choices and explain your criteria.', 'presentation', 'medium', 60, 'defend_recommendation'),
    ('Explain why a small daily habit can make a practical difference.', 'presentation', 'medium', 45, 'explain_idea'),
    ('Pitch an event that would help neighbors get to know one another.', 'presentation', 'hard', 60, 'pitch'),
    ('Summarize two sides of a familiar debate before stating your view.', 'presentation', 'hard', 60, 'summarize'),
    ('Teach someone how to make a decision when they have limited time.', 'presentation', 'hard', 60, 'teach'),
    ('Persuade a group to keep a useful tradition even when it takes effort.', 'presentation', 'hard', 60, 'persuade'),
    ('Defend your recommendation for changing a shared routine when others prefer the current one.', 'presentation', 'hard', 60, 'defend_recommendation'),
    ('Disagree with a friend who wants to skip planning and decide everything at the last minute.', 'conversation', 'easy', 45, 'disagreement'),
    ('Give kind, specific feedback to a friend who keeps arriving late.', 'conversation', 'easy', 45, 'giving_feedback'),
    ('Ask follow-up questions when someone gives you unclear directions.', 'conversation', 'easy', 30, 'asking_clarification'),
    ('Raise a concern about a shared plan that may leave someone out.', 'conversation', 'medium', 60, 'raising_concern'),
    ('Set a boundary when a friend asks you to answer messages late at night.', 'conversation', 'medium', 45, 'setting_boundary'),
    ('Explain why you chose a quieter plan when others wanted something busy.', 'conversation', 'medium', 45, 'explaining_decision'),
    ('Disagree with someone who thinks a quick answer is always better than a careful one.', 'conversation', 'medium', 60, 'disagreement'),
    ('Give feedback to a group member whose interruptions make it hard to talk.', 'conversation', 'hard', 60, 'giving_feedback'),
    ('Ask for clarification after someone changes the plan without explaining why.', 'conversation', 'medium', 45, 'asking_clarification'),
    ('Raise a concern when a friend shares something about you without asking first.', 'conversation', 'hard', 60, 'raising_concern'),
    ('Set a boundary with someone who repeatedly changes plans after you have agreed.', 'conversation', 'hard', 60, 'setting_boundary'),
    ('Explain a decision to leave a group activity when the timing no longer works for you.', 'conversation', 'hard', 60, 'explaining_decision')
)
insert into public.prompts (text, mode, difficulty, target_duration_seconds, collection_id)
select catalog.text, catalog.mode, catalog.difficulty, catalog.target_duration_seconds, catalog.collection_id
from catalog
where not exists (select 1 from public.prompts as prompt where prompt.text = catalog.text);
