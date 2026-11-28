use serde::{Deserialize, Serialize};
use std::fmt::Display;

#[derive(Clone, Copy, Debug, Default, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "lowercase")]
pub(crate) enum Language {
    #[default]
    Fa,
    En,
}

impl Language {
    pub(crate) fn text(self, fa: &'static str, en: &'static str) -> &'static str {
        match self {
            Self::Fa => fa,
            Self::En => en,
        }
    }

    pub(crate) fn detail(self, fa: &'static str, en: &'static str, error: impl Display) -> String {
        format!("{} {error}", self.text(fa, en))
    }

    pub(crate) fn window_title(self) -> &'static str {
        self.text("Video Converter | تبدیل ویدیو", "Video Converter")
    }
}
