-- Keep slot lookups indexed within each hero/objective, including existing uploads.
CREATE INDEX builds_main2_lookup ON builds (hero_id, objective, json_extract(payload, '$.souls[1].mainAttribute.name'), created_at DESC, id DESC);
CREATE INDEX builds_main4_lookup ON builds (hero_id, objective, json_extract(payload, '$.souls[3].mainAttribute.name'), created_at DESC, id DESC);
CREATE INDEX builds_main6_lookup ON builds (hero_id, objective, json_extract(payload, '$.souls[5].mainAttribute.name'), created_at DESC, id DESC);
