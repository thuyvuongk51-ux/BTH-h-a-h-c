// netlify/functions/chat.js
// Netlify Function. Nhận request từ frontend, gọi Gemini API, trả kết quả về.
// API key được giữ an toàn ở đây, KHÔNG bao giờ lộ ra frontend.

exports.handler = async (event) => {
  // Chỉ chấp nhận POST
  if (event.httpMethod !== "POST") {
    return {
      statusCode: 405,
      body: JSON.stringify({ error: "Chỉ hỗ trợ phương thức POST" }),
    };
  }

  let body;
  try {
    body = JSON.parse(event.body || "{}");
  } catch (e) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: "Body không phải JSON hợp lệ" }),
    };
  }

  const { mode, message, topic, level, count } = body;

  const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
  if (!GEMINI_API_KEY) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: "Server chưa cấu hình GEMINI_API_KEY" }),
    };
  }

  // Giới hạn độ dài đầu vào để tránh lạm dụng
  if (message && message.length > 2000) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: "Câu hỏi quá dài (tối đa 2000 ký tự)" }),
    };
  }

  let systemPrompt = "";
  let userPrompt = "";

  if (mode === "qa") {
    // Chế độ chatbot hỏi đáp
    systemPrompt =
      "Bạn là trợ lý Hóa học thân thiện, dạy cho học sinh THPT tại Việt Nam. " +
      "Trả lời ngắn gọn, chính xác, dùng ví dụ dễ hiểu, kèm công thức hóa học khi cần. " +
      "Nếu câu hỏi không liên quan đến Hóa học, hãy lịch sự từ chối và hướng học sinh quay lại chủ đề học tập.";
    userPrompt = message;
  } else if (mode === "exercise") {
    // Chế độ tạo bài tập tự động, yêu cầu trả về JSON có cấu trúc
    systemPrompt =
      "Bạn là giáo viên Hóa học THPT. Hãy tạo bài tập trắc nghiệm theo đúng định dạng JSON, " +
      "KHÔNG kèm giải thích ngoài JSON, KHÔNG dùng markdown code fence.";
    userPrompt = `Tạo ${count || 5} câu hỏi trắc nghiệm Hóa học về chủ đề "${topic}",
mức độ "${level || "trung bình"}". Trả về đúng định dạng JSON như sau (mảng các object):
[
  {
    "question": "...",
    "options": ["A. ...", "B. ...", "C. ...", "D. ..."],
    "answer": "A",
    "explanation": "..."
  }
]`;
  } else {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: "mode phải là 'qa' hoặc 'exercise'" }),
    };
  }

  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_API_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [
            {
              role: "user",
              parts: [{ text: `${systemPrompt}\n\n${userPrompt}` }],
            },
          ],
          generationConfig: {
            temperature: mode === "exercise" ? 0.7 : 0.4,
            maxOutputTokens: 1500,
          },
        }),
      }
    );

    const data = await response.json();

    if (!response.ok) {
      console.error("Gemini API error:", data);
      return {
        statusCode: 502,
        body: JSON.stringify({ error: "Lỗi khi gọi Gemini API" }),
      };
    }

    const text =
      data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || "";

    if (mode === "exercise") {
      // Cố gắng parse JSON; nếu model lỡ kèm ```json thì loại bỏ
      const cleaned = text.replace(/```json|```/g, "").trim();
      try {
        const exercises = JSON.parse(cleaned);
        return {
          statusCode: 200,
          body: JSON.stringify({ exercises }),
        };
      } catch (e) {
        return {
          statusCode: 200,
          body: JSON.stringify({
            raw: text,
            warning: "Không parse được JSON, trả về text thô",
          }),
        };
      }
    }

    return {
      statusCode: 200,
      body: JSON.stringify({ reply: text }),
    };
  } catch (err) {
    console.error("Server error:", err);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: "Lỗi server nội bộ" }),
    };
  }
};
