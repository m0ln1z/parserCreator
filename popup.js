let user_info_block = document.getElementById("user").querySelector('span');
let logout = document.getElementById("logout");

chrome.storage.local.get(['user_data', 'webhook_url']).then((res) => {
    const user_info = res.user_data;
    const webhook_url = res.webhook_url;

    if (!webhook_url) {
        alert("Webhook URL не найден. Пожалуйста, вернитесь на страницу авторизации и введите URL.");
        location.href = "/index.html";
        return;
    }

    user_info_block.innerHTML = `${user_info.NAME} ${user_info.LAST_NAME}`;
});

const saveToBitrixBtn = document.getElementById("saveToBitrix");
const loader = document.getElementById("loader");
const status_mess = document.getElementById("status_mess");

logout.addEventListener("click", () => {
    chrome.storage.local.clear(() => {
        location.href = "/index.html";
    });
});

saveToBitrixBtn.addEventListener("click", (e) => {
    loader.style.display = "block";
    status_mess.innerHTML = "";
    e.target.disabled = true;
    chrome.tabs.query({ active: true }, function (tabs) {
        const tab = tabs[0];
        if (tab) {
            execScript2(tab);
        } else {
            alert("Нет активных вкладок");
        }
    });
});

function execScript2(tab) {
    chrome.scripting.executeScript({
        target: { tabId: tab.id, allFrames: false },
        func: () => {
            const show_contact = document.querySelector('[data-qa="response-resume_show-phone-number"]');
            if (show_contact) {
                show_contact.click();
            }
        }
    }).then(() => {
        setTimeout(() => {
            chrome.scripting.executeScript({
                target: { tabId: tab.id, allFrames: false },
                func: getVacancyInfo
            }).then((Resume) => {
                sendToBitrix(Resume[0].result);
            });
        }, 3000);
    });
}

function getVacancyInfo() {
    function currentDate() {
        const currentDate = new Date();
        const day = currentDate.getDate().toString().padStart(2, '0');
        const month = (currentDate.getMonth() + 1).toString().padStart(2, '0');
        const year = currentDate.getFullYear();
        return `${day}.${month}.${year}`;
    }

    const vacancy = {};
    const resume = {};

    vacancy.resumeLink = window.location.href;
    vacancy.resumeId = window.location.pathname.split("/")[2];

    const vacancyNameElem = document.querySelector('div[data-qa="resume-history-sidebar-container"] div[data-qa="resume-history-item"] a');
    vacancy.vacancyName = vacancyNameElem ? vacancyNameElem.innerText : "";

    const commentBlock = document.querySelectorAll('div[data-qa="resume-comments"] div[data-qa="resume-comment-item"]');
    if (commentBlock) {
        vacancy.comments = Array.from(commentBlock).map(item => {
            return item.querySelector('span[data-qa="comment__text"]').innerText + "\n" +
                item.querySelector('div.resume-sidebar-item__info').innerText + "\n\n";
        }).join("");
    }

    vacancy.gender = document.querySelector('span[data-qa="resume-personal-gender"]').innerText || "";
    vacancy.age = document.querySelector('span[data-qa="resume-personal-age"]')?.innerText.split(' ')[0] || "";
    vacancy.address = document.querySelector('span[data-qa="resume-personal-address"]').innerText || "";
    vacancy.date = currentDate();

    const full_name = document.querySelector('[data-qa="resume-personal-name"] span').innerText.split(' ');
    resume.NAME = full_name[1];
    resume.LAST_NAME = full_name[0];

    const phone_block = document.querySelector('[data-qa="resume-contacts-phone"] > a');
    if (phone_block) resume.PHONE = [{ VALUE: phone_block.innerText, VALUE_TYPE: 'WORK' }];

    const email_block = document.querySelector('[data-qa="resume-contact-email"] span');
    if (email_block) resume.EMAIL = [{ VALUE: email_block.innerText, VALUE_TYPE: 'WORK' }];

    return { resume, vacancy };
}

function sendToBitrix(data = null) {
    if (!data) {
        loader.style.display = "none";
        status_mess.innerHTML = "<h3 style='color: red'>Что-то пошло не так!</h3>";
        saveToBitrixBtn.disabled = false;
        return;
    }
    saveToBitrixBtn.disabled = true;

    chrome.storage.local.get(['webhook_url', 'user_data']).then((res) => {
        const webhook_url = res.webhook_url;
        const user_info = res.user_data;

        if (!webhook_url) {
            alert("Webhook URL не найден. Пожалуйста, вернитесь на страницу авторизации.");
            location.href = "/index.html";
            return;
        }

        const contact_id = handleContact(data.resume, webhook_url, user_info);
        if (contact_id) {
            handleDeal(data.vacancy, webhook_url, user_info, contact_id);
        }
    });
}

function handleContact(resume, webhook_url, user_info) {
    const contactExists = callAjax(`${webhook_url}/crm.contact.list`, {
        filter: { PHONE: resume.PHONE[0].VALUE }
    }, 'post');

    if (contactExists?.result?.length) {
        const contact = contactExists.result[0];
        displayStatus(`Контакт с таким номером уже есть: ${contact.LAST_NAME} ${contact.NAME}`, 'red');
        return contact.ID;
    }

    const new_contact = callAjax(`${webhook_url}/crm.contact.add`, {
        fields: { ...resume, ASSIGNED_BY_ID: user_info.ID }
    }, 'post');

    if (new_contact.result) {
        displayStatus(`Контакт успешно создан: ${resume.LAST_NAME} ${resume.NAME}`, 'green');
        return new_contact.result;
    }

    displayStatus("Ошибка создания контакта.", 'red');
    return null;
}

function handleDeal(vacancy, webhook_url, user_info, contact_id) {
    vacancy.CONTACT_ID = contact_id;
    vacancy.TITLE = `${vacancy.vacancyName} / ${vacancy.resume.LAST_NAME} ${vacancy.resume.NAME}`;

    const dealExists = callAjax(`${webhook_url}/crm.deal.list`, {
        filter: { UF_CRM_1708209177676: vacancy.resumeId }
    }, 'post');

    if (dealExists?.result?.length) {
        displayStatus(`Сделка уже существует: ${dealExists.result[0].TITLE}`, 'red');
        return;
    }

    const new_deal = callAjax(`${webhook_url}/crm.deal.add`, { fields: vacancy }, 'post');
    if (new_deal.result) {
        displayStatus(`Сделка успешно создана: ${vacancy.TITLE}`, 'green');
    } else {
        displayStatus("Ошибка создания сделки.", 'red');
    }
}

function callAjax(url, data = null, method = 'post') {
    let result = null;
    const xhr = new XMLHttpRequest();
    xhr.open(method, url, false);
    xhr.setRequestHeader('Content-Type', 'application/json');
    xhr.onreadystatechange = () => {
        if (xhr.readyState === 4 && xhr.status === 200) {
            result = JSON.parse(xhr.responseText);
        }
    };
    xhr.send(JSON.stringify(data));
    return result;
}

function displayStatus(message, color) {
    const div = document.createElement('div');
    div.innerHTML = message;
    div.style.color = color;
    status_mess.appendChild(div);
}