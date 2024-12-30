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

/**
 * Собираем всю нужную информацию о резюме:
 * - Сопроводительное письмо
 * - ФИО
 * - Специализация
 * - Навыки
 * - Обо мне
 * - Образование
 * - Знание языков
 * - Гражданство
 * - Общий стаж (из заголовка "Опыт работы 9 лет ...")
 * - Детальный опыт работы (каждая компания)
 * - Пользовательские комментарии, которые мы сами оставили (data-qa="comment__text")
 * - Старые комментарии HH (если есть)
 */
function getVacancyInfo() {
    // Вспомогательная функция для форматирования текущей даты
    function currentDate() {
        const currentDate = new Date();
        const day = currentDate.getDate().toString().padStart(2, '0');
        const month = (currentDate.getMonth() + 1).toString().padStart(2, '0');
        const year = currentDate.getFullYear();
        return `${day}.${month}.${year}`;
    }

    const vacancy = {};
    const resume = {};

    // Базовая информация: ссылка на резюме, ID
    vacancy.resumeLink = window.location.href;
    vacancy.resumeId = window.location.pathname.split("/")[2];

    // Название вакансии (если есть история откликов)
    const vacancyNameElem = document.querySelector('div[data-qa="resume-history-sidebar-container"] div[data-qa="resume-history-item"] a');
    vacancy.vacancyName = vacancyNameElem ? vacancyNameElem.innerText : "";

    // Собираем "старые комментарии" HH
    const commentBlock = document.querySelectorAll('div[data-qa="resume-comments"] div[data-qa="resume-comment-item"]');
    let existingHhComments = "";
    if (commentBlock) {
        existingHhComments = Array.from(commentBlock).map(item => {
            return (
                item.querySelector('span[data-qa="comment__text"]').innerText + "\n" +
                item.querySelector('div.resume-sidebar-item__info').innerText + "\n\n"
            );
        }).join("");
    }

    // Пол, возраст, адрес, дата
    vacancy.gender = document.querySelector('span[data-qa="resume-personal-gender"]')?.innerText || "";
    vacancy.age = document.querySelector('span[data-qa="resume-personal-age"]')?.innerText.split(' ')[0] || "";
    vacancy.address = document.querySelector('span[data-qa="resume-personal-address"]')?.innerText || "";
    vacancy.date = currentDate();

    // ФИО (стандартный способ через data-qa="resume-personal-name")
    const full_name = document.querySelector('[data-qa="resume-personal-name"] span')?.innerText.split(' ');
    resume.NAME = full_name?.[1] || "";
    resume.LAST_NAME = full_name?.[0] || "";

    // Телефон и email
    const phone_block = document.querySelector('[data-qa="resume-contacts-phone"] > a');
    if (phone_block) {
        resume.PHONE = [{ VALUE: phone_block.innerText, VALUE_TYPE: 'WORK' }];
    }
    const email_block = document.querySelector('[data-qa="resume-contact-email"] span');
    if (email_block) {
        resume.EMAIL = [{ VALUE: email_block.innerText, VALUE_TYPE: 'WORK' }];
    }

    // -------------------- Начинаем собирать кастомные блоки --------------------
    let customBlocksText = "";

    // (1) Сопроводительное письмо
    const coverLetter = document.querySelector('.resume-block-letter__show');
    if (coverLetter) {
        customBlocksText += "Сопроводительное письмо:\n" + coverLetter.innerText.trim() + "\n\n";
    }

    // (2) ФИО из h2.bloko-header-1 span (по классам, если нужно дублировать)
    const fioFromClass = document.querySelector('h2.bloko-header-1 span');
    if (fioFromClass) {
        customBlocksText += "ФИО (из h2.bloko-header-1):\n" + fioFromClass.innerText.trim() + "\n\n";
    }

    // (3) Специализация (li.resume-block__specialization)
    const specializationElem = document.querySelector('li.resume-block__specialization');
    if (specializationElem) {
        customBlocksText += "Специализация:\n" + specializationElem.innerText.trim() + "\n\n";
    }

    // (4) Навыки (ищем .bloko-tag-list внутри .resume-block)
    const skillTags = document.querySelectorAll('.resume-block .bloko-tag-list .bloko-tag');
    if (skillTags.length > 0) {
        const skillsText = Array.from(skillTags).map(tag => tag.innerText.trim()).join(', ');
        customBlocksText += "Навыки:\n" + skillsText + "\n\n";
    }

    // (5) Обо мне (блок, где h2 содержит "Обо мне")
    const aboutMeBlock = Array.from(document.querySelectorAll('.resume-block')).find(block => {
        const h2 = block.querySelector('h2.bloko-header-2');
        return h2 && h2.innerText.includes('Обо мне');
    });
    if (aboutMeBlock) {
        const aboutMeTextElem = aboutMeBlock.querySelector('.resume-block-container[data-qa="resume-block-skills-content"]')
                               || aboutMeBlock.querySelector('.resume-block-container');
        if (aboutMeTextElem) {
            customBlocksText += "Обо мне:\n" + aboutMeTextElem.innerText.trim() + "\n\n";
        }
    }

    // (6) Образование
    const educationBlocks = document.querySelectorAll('.resume-block-item-gap .resume-block-container');
    let educationText = "";
    educationBlocks.forEach(block => {
        if (block.innerText.toLowerCase().includes('техникум')
            || block.innerText.toLowerCase().includes('университет')
            || block.innerText.toLowerCase().includes('институт')
            || block.innerText.toLowerCase().includes('колледж')
        ) {
            educationText += block.innerText.trim() + "\n";
        }
    });
    if (educationText) {
        customBlocksText += "Образование:\n" + educationText + "\n";
    }

    // (7) Знание языков
    const languagesBlock = Array.from(document.querySelectorAll('.resume-block')).find(block => {
        const h2 = block.querySelector('h2.bloko-header-2');
        return h2 && h2.innerText.includes('Знание языков');
    });
    if (languagesBlock) {
        const languageTags = languagesBlock.querySelectorAll('.bloko-tag-list .bloko-tag');
        let languagesText = "";
        if (languageTags.length > 0) {
            languagesText = Array.from(languageTags).map(tag => tag.innerText.trim()).join(', ');
        }
        // Дополнительно проверим параграфы <p>
        const languageParagraphs = languagesBlock.querySelectorAll('p');
        languageParagraphs.forEach(p => {
            if (p.innerText.toLowerCase().includes('русский') 
                || p.innerText.toLowerCase().includes('английский')
                || p.innerText.toLowerCase().includes('немецкий')
            ) {
                if (languagesText) languagesText += "\n";
                languagesText += p.innerText.trim();
            }
        });
        if (languagesText) {
            customBlocksText += "Знание языков:\n" + languagesText.trim() + "\n\n";
        }
    }

    // (8) Гражданство
    const citizenshipBlock = Array.from(document.querySelectorAll('.resume-block')).find(block => {
        const h2 = block.querySelector('h2.bloko-header-2');
        return h2 && h2.innerText.includes('Гражданство');
    });
    if (citizenshipBlock) {
        customBlocksText += "Гражданство:\n" + citizenshipBlock.innerText.trim() + "\n\n";
    }

    // (9) Общий стаж (из заголовка "Опыт работы 9 лет 10 месяцев")
    const totalExperienceElem = document.querySelector(
        'h2[data-qa="bloko-header-2"].bloko-header-2_lite .resume-block__title-text_sub'
    );
    if (totalExperienceElem) {
        const totalExpText = totalExperienceElem.innerText.trim(); 
        customBlocksText += "Общий стаж (из заголовка): " + totalExpText + "\n\n";
    }

    // (10) Детальный список мест работы (каждый .resume-block-item-gap с data-qa="resume-block-experience-position")
    const experienceItems = document.querySelectorAll('.resume-block-item-gap');
    let experienceInfo = "";
    experienceItems.forEach((item) => {
        const positionBlock = item.querySelector('[data-qa="resume-block-experience-position"]');
        if (!positionBlock) return; // не похоже на опыт

        // Даты (левая колонка)
        const leftCol = item.querySelector('.bloko-column_s-2,.bloko-column_m-2,.bloko-column_l-2,.bloko-column_xs-4');
        const dateText = leftCol ? leftCol.innerText.replace(/\s+/g, ' ').trim() : "";

        // Название компании (может быть <span> или <a>)
        let companySpan = item.querySelector(
            '.bloko-column_s-6 .bloko-text.bloko-text_strong span,' +
            '.bloko-column_m-7 .bloko-text.bloko-text_strong span,' +
            '.bloko-column_l-10 .bloko-text.bloko-text_strong span,' +
            '.bloko-column_s-6 .bloko-text.bloko-text_strong a,' +
            '.bloko-column_m-7 .bloko-text.bloko-text_strong a,' +
            '.bloko-column_l-10 .bloko-text.bloko-text_strong a'
        );
        let companyName = companySpan ? companySpan.innerText.trim() : "";

        // Город (обычно <p> под названием компании)
        let cityElem = item.querySelector('.bloko-column_s-6 p, .bloko-column_m-7 p, .bloko-column_l-10 p');
        let city = cityElem ? cityElem.innerText.trim() : "";

        // Должность
        let position = positionBlock.innerText.trim();

        // Описание
        const descBlock = item.querySelector('[data-qa="resume-block-experience-description"]');
        let description = descBlock ? descBlock.innerText.trim() : "";

        experienceInfo += "----------------------------------\n";
        experienceInfo += `Период: ${dateText}\n`;
        experienceInfo += `Компания: ${companyName}\n`;
        experienceInfo += `Город: ${city}\n`;
        experienceInfo += `Должность: ${position}\n`;
        experienceInfo += `Описание: ${description}\n`;
    });
    if (experienceInfo) {
        customBlocksText += "=== Детальный опыт работы ===\n" + experienceInfo + "\n";
    }

    // (11) Наши собственные комментарии (data-qa="comment__text" внутри resume-sidebar-item__text-wrapper_full)
    const userOwnComments = document.querySelectorAll(
        '.resume-sidebar-item__text-wrapper_full span[data-qa="comment__text"]'
    );
    if (userOwnComments && userOwnComments.length > 0) {
        const userCommentsText = Array.from(userOwnComments)
            .map(elem => elem.innerText.trim())
            .join('\n');
        customBlocksText += "=== Наши комментарии о кандидате ===\n" + userCommentsText + "\n\n";
    }

    // ----- В конце добавим "старые комментарии" HH (если были) -----
    if (existingHhComments) {
        customBlocksText += "==== Старые комментарии (HH) ====\n" + existingHhComments;
    }

    // Пишем всё это в vacancy.comments
    vacancy.comments = customBlocksText;

    // Возвращаем результат
    return { resume, vacancy };
}

/**
 * Отправляем данные в Битрикс: создаём контакт и пишем туда COMMENTS.
 * Сделку НЕ создаём. Контакт будет назван "HH Имя Фамилия".
 */
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

        // Запишем собранные комментарии в поле resume.COMMENTS
        data.resume.COMMENTS = data.vacancy.comments || "";

        // Создаём / ищем контакт
        handleContact(data.resume, webhook_url, user_info);
    });
}

/**
 * handleContact: создаём контакт и прописываем в поле COMMENTS — всё, что собрали.
 * Название контакта: "HH Имя Фамилия"
 */
function handleContact(resume, webhook_url, user_info) {
    // Ищем контакт по номеру телефона
    const contactExists = callAjax(`${webhook_url}/crm.contact.list`, {
        filter: { PHONE: resume.PHONE?.[0]?.VALUE || "" }
    }, 'post');

    if (contactExists?.result?.length) {
        const contact = contactExists.result[0];
        displayStatus(`Контакт с таким номером уже есть: ${contact.LAST_NAME} ${contact.NAME}`, 'red');
        return contact.ID;
    }

    // Формируем название контакта (NAME) = "HH Имя Фамилия"
    const contactName = `HH ${resume.NAME} ${resume.LAST_NAME}`.trim();

    // Создаем новый контакт, пишем COMMENTS
    const new_contact = callAjax(`${webhook_url}/crm.contact.add`, {
        fields: {
            NAME: contactName,
            LAST_NAME: "", // Можно оставить пустым, чтобы не мешало отображению
            PHONE: resume.PHONE || [],
            EMAIL: resume.EMAIL || [],
            COMMENTS: resume.COMMENTS || "",
            ASSIGNED_BY_ID: user_info.ID
        }
    }, 'post');

    if (new_contact?.result) {
        displayStatus(`Контакт успешно создан: ${contactName}`, 'green');
        return new_contact.result;
    }

    displayStatus("Ошибка создания контакта.", 'red');
    return null;
}

/**
 * callAjax: универсальная функция для запросов (синхронно) к Битрикс.
 */
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

/**
 * displayStatus: выводим сообщения на экран (статус).
 */
function displayStatus(message, color) {
    const div = document.createElement('div');
    div.innerHTML = message;
    div.style.color = color;
    status_mess.appendChild(div);
}
