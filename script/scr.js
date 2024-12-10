// Функция для получения URL из вебхука
function getWebhookUrl() {
    return chrome.storage.local.get(['webhook_url']).then(res => {
        if (res.webhook_url) {
            return res.webhook_url;
        } else {
            return Promise.reject('Webhook URL не установлен');
        }
    });
}

// Функция для выполнения логина
function login(data) {
    return getWebhookUrl().then(url => {
        const fullUrl = `${url}/profile.json`; // URL из вебхука
        return fetch(fullUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(data)
        })
            .then(response => response.json())
            .then(result => result)
            .catch(error => {
                console.error('Error:', error);
            });
    });
}

// Проверка сохранённых данных
chrome.storage.local.get(['bx_data']).then((res) => {
    if (typeof res.bx_data !== "undefined") {
        login(res.bx_data).then(result => {
            if (typeof (result.error) !== "undefined") {
                $("#user").html("Вы ввели неверные данные. Попробуйте снова");
            } else {
                location.href = "/popup.html";
            }
        });
    }
    $(".container").show();
});

// Настройка формы
$(function () {
    const form = $("form");

    form.on("submit", (e) => {
        e.preventDefault();
        const data = {
            user_id: $(e.target).find('#login').val(),
            token: $(e.target).find('#pass').val()
        };

        login(data).then(result => {
            if (typeof (result.error) !== "undefined") {
                $("#user").html("Вы ввели неверные данные. Попробуйте снова");
            } else {
                chrome.storage.local.set({ bx_data: data, user_data: result.result }, function () {
                    location.href = "/popup.html";
                });
            }
        });
    });

    // Форма для установки вебхука
    const webhookForm = $("<form>").attr("id", "webhookForm").append(
        $("<div>").addClass("form-group").append(
            $("<label>").attr("for", "webhook").text("Webhook URL"),
            $("<input>").addClass("form-control").attr({ id: "webhook", placeholder: "Введите URL вебхука" })
        ),
        $("<button>").addClass("btn btn-primary btn-block").attr("type", "submit").text("Сохранить Webhook")
    );

    $(".container").prepend(webhookForm);

    $("#webhookForm").on("submit", (e) => {
        e.preventDefault();
        const webhookUrl = $("#webhook").val().trim();
        if (webhookUrl) {
            chrome.storage.local.set({ webhook_url: webhookUrl }, function () {
                alert("Webhook URL сохранён");
            });
        } else {
            alert("Введите корректный Webhook URL");
        }
    });
});