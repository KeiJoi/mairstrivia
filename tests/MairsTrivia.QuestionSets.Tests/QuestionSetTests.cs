using MairsTrivia.QuestionSets;
using Xunit;

namespace MairsTrivia.QuestionSets.Tests;
public sealed class QuestionSetTests
{
    private static QuestionSet Valid() => new() { Title="Unicode: ひかり ✨", Categories=["General"], Tags=["tag"], Questions=[new() { Question="Question?", CorrectAnswer="Correct", IncorrectAnswers=Enumerable.Range(1,9).Select(x=>$"Wrong {x}").ToList(), Category="General", Tags=["tag"] }] };
    [Fact] public void Serialization_uses_shared_contract_and_stable_ids(){var set=Valid();var text=QuestionSetSerializer.Serialize(set);var copy=QuestionSetSerializer.Deserialize(text);Assert.Contains("\"format\": \"fftrivia-question-set\"",text);Assert.Equal(set.Id,copy.Id);Assert.Equal(set.Questions[0].Id,copy.Questions[0].Id);Assert.Empty(QuestionSetValidator.Validate(copy));}
    [Fact] public void Save_load_round_trip_preserves_unicode_tags_and_categories(){var path=Path.GetTempFileName();try{var set=Valid();QuestionSetSerializer.Save(path,set);var copy=QuestionSetSerializer.Load(path);Assert.Equal("Unicode: ひかり ✨",copy.Title);Assert.Equal(set.Tags,copy.Tags);Assert.Equal(set.Categories,copy.Categories);}finally{File.Delete(path);}}
    [Fact] public void Validator_rejects_wrong_answer_count_and_duplicates(){var set=Valid();set.Questions[0].IncorrectAnswers.RemoveAt(0);set.Questions[0].IncorrectAnswers[0]=set.Questions[0].CorrectAnswer;var issues=QuestionSetValidator.Validate(set);Assert.Contains(issues,x=>x.Message.Contains("Exactly 9"));Assert.Contains(issues,x=>x.Message.Contains("distinct"));}
    [Fact] public void Validator_rejects_unsupported_versions_and_duplicate_ids(){var set=Valid();set.SchemaVersion=2;set.Questions.Add(set.Questions[0].Copy());set.Questions[1].Id=set.Questions[0].Id;var issues=QuestionSetValidator.Validate(set);Assert.Contains(issues,x=>x.Path=="schemaVersion");Assert.Contains(issues,x=>x.Message.Contains("unique"));}
    [Fact] public void Deserializer_rejects_malformed_files()=>Assert.Throws<QuestionSetFormatException>(()=>QuestionSetSerializer.Deserialize("{not json"));
    [Fact] public void Deserializer_rejects_fields_outside_the_schema()=>Assert.Throws<QuestionSetFormatException>(()=>QuestionSetSerializer.Deserialize("{\"format\":\"fftrivia-question-set\",\"unexpected\":true}"));
}
