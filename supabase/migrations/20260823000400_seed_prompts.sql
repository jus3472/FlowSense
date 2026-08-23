-- 20 everyday prompts. Low stakes on purpose: the difficulty comes from
-- speaking without preparation, not from the subject.

insert into public.prompts (text)
select value from (
  values
    ('Describe your ideal weekend.'),
    ('Explain how to make something you cook often.'),
    ('Talk about a place you would like to visit.'),
    ('What is something you changed your mind about?'),
    ('Describe your hometown to someone who has never been there.'),
    ('Explain something you are good at to a complete beginner.'),
    ('What advice would you give your younger self?'),
    ('Describe a trip that did not go as planned.'),
    ('Talk about a song you keep coming back to.'),
    ('Explain the rules of a game you know well.'),
    ('Describe the last thing that made you laugh.'),
    ('Talk about a habit you picked up in the last year.'),
    ('What would you do with a free afternoon and no plans?'),
    ('Describe a meal you still remember clearly.'),
    ('Explain how you decide what to watch or read next.'),
    ('Talk about someone who taught you something useful.'),
    ('Describe the room you are sitting in right now.'),
    ('What is a small thing that makes your day better?'),
    ('Talk about a skill you tried and did not stick with.'),
    ('Explain how you would spend a week in a city you love.')
) as seed (value)
where not exists (select 1 from public.prompts p where p.text = seed.value);
