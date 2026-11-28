/// Produces a Windows filename stem. Finglish uses a course vocabulary from the
/// legacy renamer and transliterates unfamiliar Persian words letter by letter.
pub fn output_stem(stem: &str, finglish: bool) -> String {
    let clean = if finglish {
        finglish_slug(stem)
    } else {
        stem.chars()
            .map(|character| match character {
                '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*' => '-',
                character if character.is_control() => '-',
                character => character,
            })
            .collect()
    };

    // Leave room for a collision suffix and extension within a Windows file component.
    let mut units = 0;
    let bounded: String = clean
        .chars()
        .take_while(|character| {
            units += character.len_utf16();
            units <= 200
        })
        .collect();
    let bounded = bounded.trim_matches([' ', '.']);
    let bounded = if finglish {
        bounded.trim_end_matches('-')
    } else {
        bounded
    };

    if bounded.is_empty() {
        return "file".into();
    }

    let device = bounded
        .split('.')
        .next()
        .unwrap_or_default()
        .trim_end_matches(' ')
        .to_ascii_uppercase();
    let serial_device = device
        .strip_prefix("COM")
        .or_else(|| device.strip_prefix("LPT"))
        .is_some_and(|number| {
            matches!(
                number,
                "1" | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9" | "¹" | "²" | "³"
            )
        });
    if serial_device
        || matches!(
            device.as_str(),
            "CON" | "PRN" | "AUX" | "NUL" | "CONIN$" | "CONOUT$"
        )
    {
        return format!("_{bounded}");
    }

    bounded.into()
}

fn finglish_slug(stem: &str) -> String {
    let mut normalized = String::new();
    let mut previous_persian = None;
    for character in stem.chars() {
        let character = match character {
            '۰'..='۹' => (b'0' + (character as u32 - '۰' as u32) as u8).into(),
            '٠'..='٩' => (b'0' + (character as u32 - '٠' as u32) as u8).into(),
            'ي' | 'ى' => 'ی',
            'ك' => 'ک',
            'ة' | 'ۀ' => 'ه',
            '\u{0640}' | '\u{064b}'..='\u{065f}' | '\u{0670}' | '\u{200e}' | '\u{200f}' => {
                continue;
            }
            _ => character,
        };

        let persian = ('\u{0600}'..='\u{06ff}').contains(&character) && character.is_alphabetic();
        if !persian && !character.is_ascii_alphanumeric() {
            normalized.push(' ');
            previous_persian = None;
            continue;
        }
        if previous_persian.is_some_and(|previous| previous != persian) {
            normalized.push(' ');
        }
        normalized.push(character.to_ascii_lowercase());
        previous_persian = Some(persian);
    }

    let mut words = normalized.split_whitespace().peekable();
    let mut parts = Vec::new();
    while let Some(word) = words.next() {
        if let Some(phrase) = words.peek().and_then(|next| known_phrase(word, next)) {
            parts.push(phrase.to_owned());
            words.next();
        } else if let Some(known) = known_word(word) {
            parts.push(known.to_owned());
        } else if word.is_ascii() {
            parts.push(word.to_owned());
        } else {
            parts.push(transliterate(word));
        }
    }

    parts.join("-")
}

fn known_phrase(first: &str, second: &str) -> Option<&'static str> {
    Some(match (first, second) {
        ("آقای" | "اقای", "دکتر") => "aghaye-doctor",
        ("خانم", "دکتر") => "khanom-doctor",
        ("آقای" | "اقای", "مهندس") => "aghaye-mohandes",
        ("جلسه", "اول") => "session-aval",
        ("قسمت", "اول") => "ghesmat-aval",
        ("کلاس", "اول") => "class-aval",
        ("کلاس", "دوم") => "class-2",
        ("دوره", "هشتم") => "dore-8",
        ("جمع", "بندی") => "jambandi",
        ("پیش", "نمایش") => "pishnamayesh",
        _ => return None,
    })
}

fn known_word(word: &str) -> Option<&'static str> {
    Some(match word {
        "کلاس" => "class",
        "جلسه" => "session",
        "درس" => "lesson",
        "دوره" => "dore",
        "فصل" => "fasl",
        "بخش" => "bakhsh",
        "قسمت" => "ghesmat",
        "ویدیو" | "ویدیوی" | "ویدئو" | "ویدئوی" => "video",
        "فیلم" => "film",
        "فایل" => "file",
        "جزوه" => "jozve",
        "نمونه" => "nemone",
        "تمرین" => "tamrin",
        "تمرینات" => "tamrinat",
        "سوال" | "سؤال" => "soal",
        "پاسخ" => "pasokh",
        "جواب" => "javab",
        "حل" => "hal",
        "تشریحی" => "tashrihi",
        "تست" => "test",
        "آزمون" | "ازمون" => "azmoon",
        "کنکور" => "konkoor",
        "نکته" => "nokte",
        "نکات" => "nokat",
        "جمع" => "jam",
        "جمعبندی" => "jambandi",
        "مرور" => "moroor",
        "تحلیل" => "tahlil",
        "بررسی" => "barresi",
        "آموزش" | "اموزش" => "amoozesh",
        "آموزشی" | "اموزشی" => "amoozeshi",
        "مقدماتی" => "moghadamati",
        "پیشرفته" => "pishrafte",
        "مقدمه" => "moghadame",
        "معرفی" => "moarefi",
        "پروژه" => "prozhe",
        "پیشنمایش" => "pishnamayesh",
        "آقا" | "اقا" => "agha",
        "آقای" | "اقای" => "aghaye",
        "خانم" => "khanom",
        "دکتر" => "doctor",
        "مهندس" => "mohandes",
        "استاد" => "ostad",
        "ریاضی" => "riazi",
        "فیزیک" => "fizik",
        "شیمی" => "shimi",
        "زیست" => "zist",
        "عربی" => "arabi",
        "فارسی" => "farsi",
        "ادبیات" => "adabiat",
        "زبان" => "zaban",
        "انگلیسی" => "english",
        "هندسه" => "hendese",
        "حسابان" => "hesaban",
        "آمار" => "amar",
        "احتمال" => "ehtemal",
        "گسسته" => "gosaste",
        "جبر" => "jabr",
        "صفر" => "0",
        "یک" => "1",
        "اول" => "aval",
        "اولین" => "avalin",
        "دو" | "دوم" | "دومین" => "2",
        "سه" | "سوم" | "سومین" => "3",
        "چهار" | "چهارم" => "4",
        "پنج" | "پنجم" => "5",
        "شش" | "ششم" => "6",
        "هفت" | "هفتم" => "7",
        "هشت" | "هشتم" => "8",
        "نه" | "نهم" => "9",
        "ده" | "دهم" => "10",
        "یازده" | "یازدهم" => "11",
        "دوازده" | "دوازدهم" => "12",
        "سیزده" | "سیزدهم" => "13",
        "چهارده" | "چهاردهم" => "14",
        "پانزده" | "پانزدهم" => "15",
        "شانزده" | "شانزدهم" => "16",
        "هفده" | "هفدهم" => "17",
        "هجده" | "هجدهم" => "18",
        "نوزده" | "نوزدهم" => "19",
        "بیست" | "بیستم" => "20",
        "امین" => "amin",
        "غلامی" => "gholami",
        "هادی" => "hadi",
        "حسنعلی" => "hasanali",
        "خاویر" => "khavier",
        "کاویار" => "kaviar",
        "محمد" => "mohammad",
        "احمد" => "ahmad",
        "محمود" => "mahmood",
        "علی" => "ali",
        "حسین" => "hossein",
        "حسن" => "hasan",
        "رضا" => "reza",
        "علیرضا" => "alireza",
        "امیر" => "amir",
        "امیرحسین" => "amirhossein",
        "مهدی" => "mahdi",
        "مجید" => "majid",
        "سعید" => "saeed",
        "سید" => "seyed",
        "محسن" => "mohsen",
        "مصطفی" => "mostafa",
        "مرتضی" => "morteza",
        "عباس" => "abbas",
        "اکبر" => "akbar",
        "اصغر" => "asghar",
        "زهرا" => "zahra",
        "فاطمه" => "fateme",
        "سارا" => "sara",
        "مریم" => "maryam",
        "نرگس" => "narges",
        "نیلوفر" => "niloufar",
        _ => return None,
    })
}

fn transliterate(word: &str) -> String {
    let mut output = String::new();
    let mut letters = word.chars().peekable();
    let mut previous = None;
    while let Some(letter) = letters.next() {
        let next = letters.peek().copied();
        let romanized = match letter {
            'ا' if previous == Some('و') => "",
            'آ' | 'ا' | 'أ' | 'إ' => "a",
            'و' if previous.is_none() => "v",
            'و' if next.is_none() => "o",
            'و' if matches!(previous, Some('ا' | 'آ')) || matches!(next, Some('ا' | 'آ' | 'ی')) => {
                "v"
            }
            'و' => "o",
            'ی' if previous.is_none() => "y",
            'ی' if next.is_none() => "i",
            'ی' | 'ئ' => "y",
            'ه' if next.is_none() => "e",
            'ب' => "b",
            'پ' => "p",
            'ت' | 'ط' => "t",
            'ث' | 'س' | 'ص' => "s",
            'ج' => "j",
            'چ' => "ch",
            'ح' | 'ه' => "h",
            'خ' => "kh",
            'د' => "d",
            'ذ' | 'ز' | 'ض' | 'ظ' => "z",
            'ر' => "r",
            'ژ' => "zh",
            'ش' => "sh",
            'غ' | 'ق' => "gh",
            'ف' => "f",
            'ک' => "k",
            'گ' => "g",
            'ل' => "l",
            'م' => "m",
            'ن' => "n",
            'ؤ' => "v",
            _ => "",
        };
        if !matches!(romanized, "a" | "i" | "o") || !output.ends_with(romanized) {
            output.push_str(romanized);
        }
        previous = Some(letter);
    }

    match output.as_str() {
        "dr" => "dar".into(),
        "br" => "bar".into(),
        "klas" => "class".into(),
        "" => "item".into(),
        _ => output,
    }
}

#[cfg(test)]
mod tests {
    use super::output_stem;

    #[test]
    fn renames_known_course_phrases_and_mixed_text() {
        assert_eq!(
            output_stem("جلسه اول ریاضی ۰۲", true),
            "session-aval-riazi-02"
        );
        assert_eq!(
            output_stem("Final_V2 – جمع‌بندی كلاس دوم – ١٣", true),
            "final-v2-jambandi-class-2-13"
        );
        assert_eq!(
            output_stem("جلسه۳ دکتر احمد", true),
            "session-3-doctor-ahmad"
        );
    }

    #[test]
    fn transliterates_unknown_words() {
        assert_eq!(output_stem("در گلستان", true), "dar-glstan");
        assert_eq!(output_stem("🎬", true), "file");
    }

    #[test]
    fn preserves_farsi_when_disabled_and_sanitizes_windows_names() {
        assert_eq!(output_stem("جلسه اول ریاضی ۰۲", false), "جلسه اول ریاضی ۰۲");
        assert_eq!(output_stem("   گزارش:شروع.  ", false), "گزارش-شروع");
        assert_eq!(output_stem("AUX", true), "_aux");
        assert_eq!(output_stem("LPT².old", false), "_LPT².old");
        assert_eq!(output_stem("...", false), "file");
    }

    #[test]
    fn bounds_windows_filename_length_in_utf16() {
        let name = format!("{}{}", "🎬".repeat(99), "aa🎬");
        assert_eq!(output_stem(&name, false).encode_utf16().count(), 200);
    }
}
