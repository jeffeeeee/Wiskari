import Discord, {
  Collection,
  CommandInteraction,
  TextChannel,
} from 'discord.js';

import fs from 'fs';
import Knex from 'knex';

import { runAnalytics } from './logging/analytics';
import { Sentry } from './logging/sentry';
import { loadCommands } from './commandLoader';

const knex = Knex({
  client: 'pg',
  connection: {
    host: '127.0.0.1',
    user: 'bob',
    password: 'root',
    database: 'testinen',
  },
});

const client = new Discord.Client({
  intents: ['GUILDS', 'GUILD_MESSAGES', 'GUILD_INVITES', 'GUILD_VOICE_STATES'],
});

client.on('ready', () => {
  console.log('[Discord] Kirjauduttu sisään ja valmiina. Wiskari');

  loadCommands(client);

  knex
    .select('*')
    .from('kindacringedoe')
    .where(knex.raw(`jeeason->> 'cledos' = 'meal'`))
    .then((b) => {
      console.log('bs', b);
    });
});

const commands = new Collection();
const interactions = new Collection();

const commandFiles = fs.readdirSync(`${__dirname}\\commands`).filter((file) => {
  if (file.endsWith('.ts')) return file;
  if (file.endsWith('.js')) return file;
});

const interactionFiles = fs
  .readdirSync(`${__dirname}\\interactions`)
  .filter((file) => file.endsWith('.ts'));

const eventFiles = fs
  .readdirSync(`${__dirname}\\events`)
  .filter((file) => file.endsWith('.ts'));

async function registerInteractions() {
  for (const file of commandFiles) {
    const { default: command } = await import(`.\\commands\\${file}`);
    commands.set(command.data.name, command);
  }

  for (const file of interactionFiles) {
    const { default: interaction } = await import(`.\\interactions\\${file}`);
    interactions.set(interaction.data.name, interaction);
  }

  for (const file of eventFiles) {
    const { default: event } = await import(`.\\events\\${file}`);
    client.on(event.data.name, event.execute);
  }
}

registerInteractions();

function handleInteractionError(interaction, error) {
  console.error(error);
  Sentry.captureException(error, {
    user: interaction.user,
    tags: {
      bug: 'interaction',
    },
    extra: {
      interaction,
    },
  });
  interaction.reply({
    content: `Virhe interactionissa: ${interaction.id} ${interaction.type}`,
    ephemeral: true,
  });
}

client.on('interactionCreate', async (interaction) => {
  Sentry.setUser({
    username: interaction.user.username,
    id: interaction.user.id,
    avatar: interaction.user.avatarURL(),
  });

  const sentryInteraction = {
    id: interaction.id,
    type: interaction.type,
    token: interaction.token,
    channel: {
      id: interaction.channel.id,
      name: (interaction.channel as TextChannel).name,
    },
    guild: {
      id: interaction.guild.id,
      name: interaction.guild.name,
    },
    user: {
      id: interaction.user.id,
      name: interaction.user.username,
    },
    options: (interaction as CommandInteraction).options
      ? (interaction as CommandInteraction).options.data
      : 'Ei optionei',
  };

  const transaction = Sentry.startTransaction({
    op: `interaction@${interaction.type}`,
    name: interaction.id,
    data: {
      interaction: sentryInteraction,
    },
  });

  Sentry.addBreadcrumb({
    category: 'interaction',
    message: `Uusi interaction jonka id: ${interaction.id}`,
    level: Sentry.Severity.Info,
    data: interaction,
  });

  if (interaction.isButton()) {
    try {
      const inter = interactions.get('button');

      runAnalytics('button', interaction.customId, interaction);
      // @ts-ignore
      await inter.execute(interaction);
      transaction.setStatus('ok');
    } catch (error) {
      handleInteractionError(interaction, error);
    }

    transaction.finish();
    return;
  }

  if (interaction.isContextMenu()) {
    try {
      const inter = interactions.get(interaction.commandName);
      if (!inter) {
        await interaction.reply({
          content:
            'Virhe contextissa. Tuollaista nappulaa ei ole koodattu' +
            ' (ei löytynyt interaction kansiosta oikealla nimellä)',
          ephemeral: true,
        });
        return;
      }

      runAnalytics('contextMenu', interaction.commandName, interaction);

      // @ts-ignore
      await inter.execute(interaction);
      transaction.setStatus('ok');
    } catch (error) {
      handleInteractionError(interaction, error);
    }

    transaction.finish();
    return;
  }

  if (interaction.isSelectMenu()) {
    try {
      const inter = interactions.get('selectmenu');

      runAnalytics('selectMenu', interaction.customId, interaction);

      // @ts-ignore
      await inter.execute(interaction);
      transaction.setStatus('ok');
    } catch (error) {
      handleInteractionError(interaction, error);
    }

    transaction.finish();
    return;
  }

  if (!interaction.isCommand()) return;

  const command = commands.get(interaction.commandName);

  if (!command) return;

  try {
    runAnalytics('command', interaction.commandName, interaction);

    // @ts-ignore
    await command.execute(interaction, client);
    transaction.setStatus('ok');
  } catch (error) {
    handleInteractionError(interaction, error);
  }

  transaction.finish();
});

client.login(process.env.token);

export { client };
